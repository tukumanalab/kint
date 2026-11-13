import { useEffect, useState } from 'react';
import { getAttendanceHistory } from '../../api/attendance';
import type { AttendanceHistoryEntry, AttendanceHistorySnapshot } from '../../types/attendance';
import { formatClock, formatDateLong, formatDateTime } from './empUtils';
import { Sheet } from './Sheet';

interface Props {
  token: string;
  attendanceId: string;
  workDate: string;
  onClose: () => void;
}

export function SnapshotLine({ snapshot }: { snapshot: AttendanceHistorySnapshot }) {
  return (
    <>
      <span>
        打刻 {formatClock(snapshot.check_in, '未打刻')} → {formatClock(snapshot.check_out, '未打刻')}
      </span>
      {(snapshot.work_start || snapshot.work_end) && (
        <span className="emp-change__sub">
          勤務指定 {formatClock(snapshot.work_start)} 〜 {formatClock(snapshot.work_end)}
        </span>
      )}
    </>
  );
}

/** 1件の勤怠記録の変更履歴。 */
export function HistorySheet({ token, attendanceId, workDate, onClose }: Props) {
  const [items, setItems] = useState<AttendanceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAttendanceHistory(token, attendanceId)
      .then((res) => {
        if (active) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '変更履歴を取得できませんでした');
      });
    return () => {
      active = false;
    };
  }, [token, attendanceId]);

  return (
    <Sheet title="変更履歴" subtitle={formatDateLong(workDate)} onClose={onClose}>
      {error && (
        <div className="emp-alert emp-alert--danger" role="alert">
          {error}
        </div>
      )}
      {!error && items === null && <div className="emp-skeleton emp-skeleton--list" />}
      {items !== null && items.length === 0 && (
        <p className="emp-empty">この記録はまだ変更されていません。</p>
      )}
      {items && items.length > 0 && (
        <ol className="emp-timeline">
          {items.map((entry) => (
            <li key={entry.id} className="emp-change">
              <div className="emp-change__meta">
                <span>{formatDateTime(entry.changed_at)}</span>
                <span className={`emp-flag emp-flag--${entry.actor_role === 'admin' ? 'admin' : 'self'}`}>
                  {entry.actor_role === 'admin' ? '管理者' : '本人'}
                </span>
              </div>
              <div className="emp-change__diff">
                <div className="emp-change__before">
                  <span className="emp-change__tag">変更前</span>
                  <SnapshotLine snapshot={entry.before} />
                </div>
                <div className="emp-change__after">
                  <span className="emp-change__tag">変更後</span>
                  <SnapshotLine snapshot={entry.after} />
                </div>
              </div>
              {entry.reason && <p className="emp-change__reason">{entry.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
