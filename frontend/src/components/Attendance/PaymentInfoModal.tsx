import { useState, useRef, useEffect } from 'react';
import type { AttendanceMonthlySummary } from '../../types/attendance';
import './AttendancePage.css';

interface PaymentInfoModalProps {
  summaries: AttendanceMonthlySummary[];
  yearMonth: string;
  onClose: () => void;
}

export function PaymentInfoModal({ summaries, yearMonth, onClose }: PaymentInfoModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copiedSection, setCopiedSection] = useState<'summary' | 'payees' | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // 年月のフォーマット (例: "2026-08" -> "2026年08月")
  const formattedYearMonth = (() => {
    const parts = yearMonth.split('-');
    if (parts.length === 2) {
      return `${parts[0]}年${parts[1]}月`;
    }
    return yearMonth;
  })();

  // 当月に勤務実績があるユーザー（実動日数 > 0 または 申請勤務時間 > 0）
  const activeWorkers = summaries.filter(
    (s) => (s.working_days && s.working_days > 0) || (s.total_requested_hours && s.total_requested_hours > 0)
  );

  // 1. 集計データ
  const workerCount = activeWorkers.length;
  const totalRequestedHours = activeWorkers.reduce(
    (sum, s) => sum + (s.total_requested_hours || 0),
    0
  );

  // 10進数 hours 形式 (例: 15.0)
  const hoursFormatted = totalRequestedHours.toFixed(1);
  const summaryText = `計${workerCount}名 合計${hoursFormatted}時間`;

  // 2. 支払先データ (「学籍番号 氏名」をカンマ区切りで1行に並べる)
  const payeeList = activeWorkers.map((s) => {
    const id = s.worker_id ? s.worker_id.trim() : '';
    const name = s.full_name ? s.full_name.trim() : s.user_name.trim();
    return `${id} ${name}`.trim();
  });
  const payeesText = payeeList.join(', ');

  const handleCopy = async (text: string, section: 'summary' | 'payees') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => {
        setCopiedSection((prev) => (prev === section ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('クリップボードへのコピーに失敗しました:', err);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="myprofile-dialog payment-info-dialog"
      onCancel={onClose}
      onClick={handleBackdropClick}
      style={{
        maxWidth: '650px',
        width: '90%',
        borderRadius: '16px',
        border: 'none',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        background: '#ffffff',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div
        className="payment-info-container"
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {/* ヘッダー */}
        <div
          className="payment-info-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>💳</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
                支払い情報 ({formattedYearMonth})
              </h2>
              <span style={{ fontSize: '0.75rem', opacity: 0.85, display: 'block', marginTop: '2px' }}>
                当月に勤務実績のある従業員の集計と支払先一覧
              </span>
            </div>
          </div>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background 0.2s',
              fontSize: '0.9rem',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
          >
            ✕
          </button>
        </div>

        {/* ボディ */}
        <div
          className="payment-info-body"
          style={{
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            background: '#f8fafc',
          }}
        >
          {/* 集計セクション */}
          <div
            className="payment-section-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📊 集計
              </h3>
              <button
                type="button"
                className="payment-copy-btn"
                onClick={() => handleCopy(summaryText, 'summary')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: copiedSection === 'summary' ? '#10b981' : '#ffffff',
                  color: copiedSection === 'summary' ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {copiedSection === 'summary' ? '✓ コピーしました' : '📋 コピー'}
              </button>
            </div>
            <div
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0.85rem 1rem',
                fontSize: '1.05rem',
                fontWeight: '600',
                color: '#0f172a',
                fontFamily: 'monospace, sans-serif',
                letterSpacing: '0.02em',
                userSelect: 'all',
              }}
            >
              {summaryText}
            </div>
          </div>

          {/* 支払先セクション */}
          <div
            className="payment-section-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                👥 支払先
              </h3>
              <button
                type="button"
                className="payment-copy-btn"
                onClick={() => handleCopy(payeesText, 'payees')}
                disabled={payeeList.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: copiedSection === 'payees' ? '#10b981' : '#ffffff',
                  color: copiedSection === 'payees' ? '#ffffff' : payeeList.length === 0 ? '#94a3b8' : '#334155',
                  cursor: payeeList.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {copiedSection === 'payees' ? '✓ コピーしました' : '📋 コピー'}
              </button>
            </div>
            {payeeList.length === 0 ? (
              <div
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '1rem',
                  fontSize: '0.85rem',
                  color: '#64748b',
                  textAlign: 'center',
                }}
              >
                当月に勤務実績のある従業員はいません。
              </div>
            ) : (
              <textarea
                readOnly
                value={payeesText}
                rows={3}
                style={{
                  width: '100%',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  fontSize: '0.9rem',
                  color: '#0f172a',
                  fontFamily: 'monospace, sans-serif',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  lineHeight: '1.5',
                }}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            )}
          </div>
        </div>

        {/* フッター */}
        <div
          className="payment-info-footer"
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="att-btn att-btn--secondary"
            onClick={onClose}
            style={{
              padding: '0.45rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
