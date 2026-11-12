import { useEffect, useState } from 'react';
import { getMonthlyAttendanceHistory } from '../../api/attendance';
import type {
  AttendanceCorrectionRequest,
  MonthlyAttendanceHistoryItem,
} from '../../types/attendance';
import { formatClock, formatDateShort, formatDateTime } from './empUtils';
import { SnapshotLine } from './HistorySheet';
import { MonthSwitcher } from './MonthSwitcher';

export type RequestsView = 'requests' | 'editlog';
type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

interface Props {
  token: string;
  userId: string;
  today: string;
  view: RequestsView;
  onChangeView: (view: RequestsView) => void;
  requests: AttendanceCorrectionRequest[];
  requestsLoaded: boolean;
  busy: boolean;
  onCancelRequest: (request: AttendanceCorrectionRequest) => void;
  logYearMonth: string;
  onChangeLogMonth: (yearMonth: string) => void;
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: '承認待ち' },
  { key: 'approved', label: '承認済み' },
  { key: 'rejected', label: '却下' },
  { key: 'all', label: 'すべて' },
];

const STATUS_LABEL: Record<AttendanceCorrectionRequest['status'], { label: string; tone: string }> = {
  pending: { label: '承認待ち', tone: 'warn' },
  approved: { label: '承認済み', tone: 'ok' },
  rejected: { label: '却下', tone: 'danger' },
};

const ACTOR_LABEL: Record<MonthlyAttendanceHistoryItem['actor_role'], string> = {
  admin: '管理者',
  employee: '本人',
  system: 'システム',
};

function EditLog({ token, userId, yearMonth }: { token: string; userId: string; yearMonth: string }) {
  const [logs, setLogs] = useState<MonthlyAttendanceHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMonthlyAttendanceHistory(token, yearMonth, userId)
      .then((res) => {
        if (!active) return;
        setLogs(res.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLogs([]);
        setError(err instanceof Error ? err.message : '編集ログを取得できませんでした');
      });
    return () => {
      active = false;
    };
  }, [token, userId, yearMonth]);

  if (error) {
    return (
      <div className="emp-alert emp-alert--danger" role="alert">
        {error}
      </div>
    );
  }
  if (logs === null) return <div className="emp-skeleton emp-skeleton--list" />;
  if (logs.length === 0) return <p className="emp-empty">この月に変更された記録はありません。</p>;

  return (
    <ol className="emp-timeline">
      {logs.map((log) => (
        <li key={log.id} className="emp-change">
          <div className="emp-change__meta">
            <strong>{formatDateShort(log.work_date)} の記録</strong>
            <span className={`emp-flag emp-flag--${log.actor_role === 'employee' ? 'self' : 'admin'}`}>
              {ACTOR_LABEL[log.actor_role]}
            </span>
          </div>
          <div className="emp-change__when">{formatDateTime(log.changed_at)} に変更</div>
          <div className="emp-change__diff">
            <div className="emp-change__before">
              <span className="emp-change__tag">変更前</span>
              <SnapshotLine snapshot={log.before} />
            </div>
            <div className="emp-change__after">
              <span className="emp-change__tag">変更後</span>
              <SnapshotLine snapshot={log.after} />
            </div>
          </div>
          {log.reason && <p className="emp-change__reason">{log.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

/** 申請タブ: 自分の修正申請の状況と、月ごとの編集ログ。 */
export function RequestsTab({
  token,
  userId,
  today,
  view,
  onChangeView,
  requests,
  requestsLoaded,
  busy,
  onCancelRequest,
  logYearMonth,
  onChangeLogMonth,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>('pending');

  const counts: Record<StatusFilter, number> = {
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
    all: requests.length,
  };
  const shown = requests.filter((r) => filter === 'all' || r.status === filter);

  return (
    <div className="emp-page">
      <header className="emp-page__head">
        <h1 className="emp-page__title">申請と変更の記録</h1>
      </header>

      <div className="emp-segment" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'requests'}
          className={`emp-segment__btn ${view === 'requests' ? 'is-active' : ''}`}
          onClick={() => onChangeView('requests')}
        >
          修正申請
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'editlog'}
          className={`emp-segment__btn ${view === 'editlog' ? 'is-active' : ''}`}
          onClick={() => onChangeView('editlog')}
        >
          編集ログ
        </button>
      </div>

      {view === 'requests' ? (
        <>
          <div className="emp-toolbar emp-toolbar--scroll">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`emp-chip ${filter === f.key ? 'emp-chip--on' : ''}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} {counts[f.key]}
              </button>
            ))}
          </div>

          {!requestsLoaded ? (
            <div className="emp-skeleton emp-skeleton--list" />
          ) : shown.length === 0 ? (
            <p className="emp-empty">
              {filter === 'pending' ? '承認待ちの申請はありません。' : '該当する申請はありません。'}
            </p>
          ) : (
            <ul className="emp-reqs">
              {shown.map((req) => {
                const st = STATUS_LABEL[req.status];
                return (
                  <li key={req.id} className="emp-card emp-req">
                    <div className="emp-req__head">
                      <strong className="emp-req__date">
                        {req.work_date ? formatDateShort(req.work_date) : '-'}
                      </strong>
                      <span className={`emp-badge emp-badge--${st.tone}`}>{st.label}</span>
                    </div>
                    <div className="emp-req__times">
                      <span>出勤 {formatClock(req.requested_check_in, '未打刻')}</span>
                      <span>退勤 {formatClock(req.requested_check_out, '未打刻')}</span>
                    </div>
                    <p className="emp-req__reason">{req.reason}</p>
                    {req.status !== 'pending' && (req.approved_by_name || req.approval_comment) && (
                      <div className={`emp-req__reply emp-req__reply--${req.status}`}>
                        {req.approved_by_name && (
                          <span className="emp-req__replier">{req.approved_by_name} さんより</span>
                        )}
                        {req.approval_comment && <p>{req.approval_comment}</p>}
                      </div>
                    )}
                    <div className="emp-req__foot">
                      <span>{formatDateTime(req.created_at)} 申請</span>
                      {req.status === 'pending' && (
                        <button
                          type="button"
                          className="emp-btn emp-btn--ghost-danger emp-btn--small"
                          disabled={busy}
                          onClick={() => onCancelRequest(req)}
                        >
                          取り消す
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <MonthSwitcher
            yearMonth={logYearMonth}
            currentYearMonth={today.slice(0, 7)}
            onChange={onChangeLogMonth}
          />
          <p className="emp-note">
            修正申請の承認や管理者による修正など、あなたの勤怠記録が変更された履歴です。
          </p>
          <EditLog key={logYearMonth} token={token} userId={userId} yearMonth={logYearMonth} />
        </>
      )}
    </div>
  );
}
