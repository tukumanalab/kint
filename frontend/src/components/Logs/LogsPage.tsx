import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { getLogs } from '../../api/logs';
import type { UseAuth } from '../../hooks/useAuth';
import type { LogEntry, LogLevel, LogsQuery } from '../../types/logs';
import './LogsPage.css';

interface Props {
  auth: UseAuth;
}

const ALL_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

const LEVEL_LABELS: Record<LogLevel, string> = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARNING: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRIT',
};

const AUTO_REFRESH_INTERVAL_MS = 10_000;

export function LogsPage({ auth }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterLevel, setFilterLevel] = useState<LogLevel | ''>('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [limit, setLimit] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true);
    setError(null);
    try {
      const query: LogsQuery = { limit };
      if (filterLevel) query.level = filterLevel;
      if (filterKeyword.trim()) query.keyword = filterKeyword.trim();
      const data = await getLogs(auth.token, query);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [auth.token, filterLevel, filterKeyword, limit]);

  // フィルタ変更時・マウント時に取得
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 自動更新
  useEffect(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoRefresh) {
      timerRef.current = setInterval(() => {
        fetchLogs();
      }, AUTO_REFRESH_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  function handleLevelChange(e: ChangeEvent<HTMLSelectElement>) {
    setFilterLevel(e.target.value as LogLevel | '');
  }

  function handleKeywordChange(e: ChangeEvent<HTMLInputElement>) {
    setFilterKeyword(e.target.value);
  }

  function handleLimitChange(e: ChangeEvent<HTMLSelectElement>) {
    setLimit(Number(e.target.value));
  }

  return (
    <div className="logs-page">
      <div className="logs-header">
        <h2 className="logs-title">バックエンドログ</h2>
        <div className="logs-toolbar">
          {/* レベルフィルタ */}
          <label className="logs-filter-label" htmlFor="log-level-select">
            レベル
          </label>
          <select
            id="log-level-select"
            className="logs-select"
            value={filterLevel}
            onChange={handleLevelChange}
          >
            <option value="">すべて</option>
            {ALL_LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                {lv}
              </option>
            ))}
          </select>

          {/* キーワード検索 */}
          <label className="logs-filter-label" htmlFor="log-keyword-input">
            キーワード
          </label>
          <input
            id="log-keyword-input"
            type="search"
            className="logs-input"
            placeholder="メッセージ・ロガー名"
            value={filterKeyword}
            onChange={handleKeywordChange}
          />

          {/* 件数 */}
          <label className="logs-filter-label" htmlFor="log-limit-select">
            最大件数
          </label>
          <select
            id="log-limit-select"
            className="logs-select"
            value={limit}
            onChange={handleLimitChange}
          >
            {[50, 100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                {n} 件
              </option>
            ))}
          </select>

          {/* 自動更新 */}
          <label className="logs-filter-label logs-auto-refresh-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {' '}自動更新 (10s)
          </label>

          {/* 手動更新 */}
          <button
            type="button"
            className="logs-refresh-btn"
            onClick={fetchLogs}
            disabled={loading}
          >
            {loading ? '読込中...' : '更新'}
          </button>
        </div>
      </div>

      {error && <p className="logs-error">{error}</p>}

      <p className="logs-count">
        {total} 件{filterLevel || filterKeyword ? '（フィルタ適用中）' : ''}
      </p>

      <div className="logs-table-wrapper">
        <table className="logs-table">
          <thead>
            <tr>
              <th className="logs-th logs-th--timestamp">タイムスタンプ</th>
              <th className="logs-th logs-th--level">レベル</th>
              <th className="logs-th logs-th--logger">ロガー</th>
              <th className="logs-th logs-th--message">メッセージ</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr>
                <td className="logs-empty" colSpan={4}>
                  ログが見つかりません
                </td>
              </tr>
            )}
            {entries.map((entry, idx) => (
              <tr key={idx} className={`logs-row logs-row--${entry.level.toLowerCase()}`}>
                <td className="logs-td logs-td--timestamp">
                  {new Date(entry.timestamp).toLocaleString('ja-JP')}
                </td>
                <td className="logs-td logs-td--level">
                  <span className={`logs-badge logs-badge--${entry.level.toLowerCase()}`}>
                    {LEVEL_LABELS[entry.level as LogLevel] ?? entry.level}
                  </span>
                </td>
                <td className="logs-td logs-td--logger">{entry.logger}</td>
                <td className="logs-td logs-td--message">
                  {entry.message}
                  {entry.exc_info && (
                    <pre className="logs-exc">{entry.exc_info}</pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
