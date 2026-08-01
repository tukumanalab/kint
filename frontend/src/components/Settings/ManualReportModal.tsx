import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { UserResponse } from '../../types/user';
import type { MonthlyReportFailedUserItem } from '../../types/attendance';
import { sendMonthlyReport } from '../../api/attendance';
import { ApiError } from '../../types/error';
import './SettingsPage.css';

interface ManualReportModalProps {
  token: string;
  employeeUsers: UserResponse[];
  onClose: () => void;
}

export function ManualReportModal({ token, employeeUsers, onClose }: ManualReportModalProps) {
  const [yearMonth, setYearMonth] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(() =>
    employeeUsers.map((u) => u.id)
  );

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    failedUsers?: MonthlyReportFailedUserItem[];
  } | null>(null);

  // 検索クエリによるフィルタリング
  const filteredEmployees = employeeUsers.filter((emp) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (emp.full_name || emp.name).toLowerCase();
    const email = (emp.email || '').toLowerCase();
    const kana = (emp.name_kana || '').toLowerCase();
    return name.includes(q) || email.includes(q) || kana.includes(q);
  });

  function handleSelectAll(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.checked) {
      const filteredIds = filteredEmployees.map((u) => u.id);
      setSelectedUserIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    } else {
      const filteredIds = new Set(filteredEmployees.map((u) => u.id));
      setSelectedUserIds((prev) => prev.filter((id) => !filteredIds.has(id)));
    }
  }

  function handleToggle(userId: string) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handleSend() {
    if (selectedUserIds.length === 0) {
      alert('送信対象の従業員が1人も選択されていません。');
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const res = await sendMonthlyReport(token, yearMonth, selectedUserIds);
      setResult({
        success: true,
        message: res.message,
        failedUsers: res.failed_users || [],
      });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.body.message : '送信処理に失敗しました。';
      setResult({
        success: false,
        message: msg,
      });
    } finally {
      setSending(false);
    }
  }

  const allFilteredSelected =
    filteredEmployees.length > 0 &&
    filteredEmployees.every((emp) => selectedUserIds.includes(emp.id));

  return (
    <div className="settings-modal-overlay" role="dialog" aria-modal="true">
      <div className="settings-modal" style={{ maxWidth: '600px', width: '90%' }}>
        <h2 className="settings-modal__title">月次勤怠レポート 手動送信</h2>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="manualYearMonth" className="settings-field__label">
            対象年月
          </label>
          <input
            id="manualYearMonth"
            type="month"
            className="settings-field__input"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            disabled={sending}
          />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem',
            }}
          >
            <label className="settings-field__label" style={{ marginBottom: 0 }}>
              送信対象従業員 ({selectedUserIds.length} / {employeeUsers.length} 名)
            </label>
            <label
              style={{
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={handleSelectAll}
                disabled={sending || filteredEmployees.length === 0}
              />
              {searchQuery ? '表示中のみ全選択' : '全員選択 / 解除'}
            </label>
          </div>

          {employeeUsers.length > 8 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <input
                type="text"
                className="settings-field__input"
                placeholder="従業員名やメールアドレスで絞り込み..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', fontSize: '0.875rem', padding: '0.4rem 0.6rem' }}
                disabled={sending}
              />
            </div>
          )}

          {employeeUsers.length === 0 ? (
            <p className="settings-field__hint">対象となるアクティブな従業員が登録されていません。</p>
          ) : filteredEmployees.length === 0 ? (
            <p className="settings-field__hint">絞り込み条件に一致する従業員が見つかりません。</p>
          ) : (
            <div
              style={{
                maxHeight: '240px',
                overflowY: 'auto',
                border: '1px solid var(--color-border-subtle, #e2e8f0)',
                borderRadius: '8px',
                background: '#ffffff',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              {filteredEmployees.map((emp) => {
                const isChecked = selectedUserIds.includes(emp.id);
                return (
                  <label
                    key={emp.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.6rem 0.85rem',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      backgroundColor: isChecked ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.08)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = isChecked
                        ? 'rgba(59, 130, 246, 0.04)'
                        : 'transparent')
                    }
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggle(emp.id)}
                        disabled={sending}
                        style={{ width: '1.05rem', height: '1.05rem', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                          {emp.full_name || emp.name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          {emp.email ? (
                            emp.email
                          ) : (
                            <span style={{ color: '#ef4444', fontWeight: 500 }}>
                              (メールアドレス未登録)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {result && (
          <div
            className={`settings-sync-result ${
              result.success ? 'settings-sync-result--success' : 'settings-sync-result--error'
            }`}
            style={{ marginBottom: '1rem' }}
          >
            <p style={{ margin: 0 }}>
              {result.success ? '✓ ' : '✕ '}
              {result.message}
            </p>
          </div>
        )}

        {result?.failedUsers && result.failedUsers.length > 0 && (
          <div
            style={{
              marginBottom: '1.25rem',
              padding: '0.85rem 1rem',
              borderRadius: '8px',
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              fontSize: '0.85rem',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: '#be123c',
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>⚠️ メール未送信・エラー対象者 ({result.failedUsers.length}名)</span>
            </div>
            <div
              style={{
                maxHeight: '140px',
                overflowY: 'auto',
                background: '#ffffff',
                borderRadius: '6px',
                border: '1px solid #ffe4e6',
              }}
            >
              {result.failedUsers.map((item) => (
                <div
                  key={item.user_id}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderBottom: '1px solid #fff1f2',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>
                      {item.full_name || item.name}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.78rem' }}>
                      {item.email || '(メールアドレス未登録)'}
                    </div>
                  </div>
                  <span style={{ color: '#e11d48', fontSize: '0.78rem', fontWeight: 500 }}>
                    {item.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          className="settings-modal__actions"
          style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}
        >
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={onClose}
            disabled={sending}
          >
            {result?.success ? '閉じる' : 'キャンセル'}
          </button>
          {!result?.success && (
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={handleSend}
              disabled={sending || selectedUserIds.length === 0}
            >
              {sending ? '送信中...' : `送信する (${selectedUserIds.length}名)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
