import { useCallback, useEffect, useState } from 'react';
import { getMonthlyAttendanceHistory } from '../../api/attendance';
import type { MonthlyAttendanceHistoryItem } from '../../types/attendance';
import './MonthlyEditLogPanel.css';

interface Props {
  token: string;
  yearMonth: string;
  userId?: string;
  targetUserName?: string;
  onClose?: () => void;
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '未設定';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

export function MonthlyEditLogPanel({ token, yearMonth, userId, targetUserName, onClose }: Props) {
  const [logs, setLogs] = useState<MonthlyAttendanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMonthlyAttendanceHistory(token, yearMonth, userId);
      setLogs(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '編集ログの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [token, yearMonth, userId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="att-edit-log-panel">
      <div className="att-edit-log-panel__header">
        <div className="att-edit-log-panel__title-group">
          <h3>
            📝 月次編集ログ ({yearMonth})
            {targetUserName && <span className="att-edit-log-panel__target">【対象: {targetUserName}】</span>}
            {!userId && <span className="att-edit-log-panel__target">【対象: 全従業員】</span>}
          </h3>
          <span className="att-edit-log-panel__badge">{logs.length} 件</span>
        </div>
        <div className="att-edit-log-panel__actions">
          <button
            type="button"
            className="att-btn att-btn--small att-btn--secondary"
            onClick={fetchLogs}
            disabled={loading}
          >
            {loading ? '更新中...' : '🔄 更新'}
          </button>
          {onClose && (
            <button
              type="button"
              className="att-btn att-btn--small att-btn--outline"
              onClick={onClose}
              title="パネルを閉じる"
            >
              ✕ 閉じる
            </button>
          )}
        </div>
      </div>

      {error && <div className="att-alert att-alert--danger">{error}</div>}

      {loading && logs.length === 0 ? (
        <div className="att-loading">編集ログを読み込み中...</div>
      ) : logs.length === 0 ? (
        <div className="att-empty">対象期間の編集ログはありません。</div>
      ) : (
        <div className="att-table-container">
          <table className="att-table att-edit-log-table">
            <thead>
              <tr>
                <th>変更日時</th>
                <th>対象日</th>
                <th>対象従業員</th>
                <th>操作者</th>
                <th>変更前の設定</th>
                <th>変更後の設定</th>
                <th>変更理由</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="att-edit-log-td--nowrap">
                    {formatDateTime(log.changed_at)}
                  </td>
                  <td className="att-edit-log-td--bold">{log.work_date}</td>
                  <td>
                    <strong>{log.target_user_name}</strong>
                    {log.target_user_full_name && (
                      <span className="att-fullname"> ({log.target_user_full_name})</span>
                    )}
                  </td>
                  <td>
                    <span className={`att-actor-badge att-actor-badge--${log.actor_role}`}>
                      {log.actor_role === 'admin' ? '管理者' : log.actor_role === 'system' ? 'システム' : '本人'}
                    </span>
                    <span className="att-actor-name"> {log.actor_name}</span>
                  </td>
                  <td>
                    <div className="att-change-snapshot">
                      <div>
                        <span className="att-meta-label">出勤:</span> {formatTime(log.before.check_in)}
                        <span className="att-meta-label" style={{ marginLeft: '8px' }}>退勤:</span> {formatTime(log.before.check_out)}
                      </div>
                      {(log.before.work_start || log.before.work_end) && (
                        <div className="att-change-snapshot__sub">
                          <span className="att-meta-label">勤務指定:</span> {formatTime(log.before.work_start)} ～ {formatTime(log.before.work_end)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="att-change-snapshot att-change-snapshot--after">
                      <div>
                        <span className="att-meta-label">出勤:</span> {formatTime(log.after.check_in)}
                        <span className="att-meta-label" style={{ marginLeft: '8px' }}>退勤:</span> {formatTime(log.after.check_out)}
                      </div>
                      {(log.after.work_start || log.after.work_end) && (
                        <div className="att-change-snapshot__sub">
                          <span className="att-meta-label">勤務指定:</span> {formatTime(log.after.work_start)} ～ {formatTime(log.after.work_end)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="att-comment-text" style={{ maxWidth: '240px' }}>
                      {log.reason}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
