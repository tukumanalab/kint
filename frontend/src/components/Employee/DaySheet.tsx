import type {
  AttendanceCorrectionRequest,
  DailyAttendanceDetail,
  PunchPeriod,
} from '../../types/attendance';
import { formatHours } from '../../utils/time';
import { StatusBadge } from './DayRow';
import {
  formatClock,
  formatDateLong,
  formatShiftText,
  getPunches,
  sourceLabel,
  statusInfo,
} from './empUtils';
import { Sheet } from './Sheet';

interface Props {
  day: DailyAttendanceDetail;
  isLocked: boolean;
  pendingRequests: Map<string, AttendanceCorrectionRequest>;
  busy: boolean;
  onClose: () => void;
  onRequestCorrection: (day: DailyAttendanceDetail, punch: PunchPeriod) => void;
  onCancelRequest: (request: AttendanceCorrectionRequest) => void;
  onToggleBreak: (punch: PunchPeriod) => void;
  onShowHistory: (attendanceId: string, workDate: string) => void;
}

/** 1日分の詳細。打刻ごとに修正申請・休憩・履歴の操作を並べる。 */
export function DaySheet({
  day,
  isLocked,
  pendingRequests,
  busy,
  onClose,
  onRequestCorrection,
  onCancelRequest,
  onToggleBreak,
  onShowHistory,
}: Props) {
  const punches = getPunches(day);
  const status = statusInfo(day.status);
  const alerts = day.daily_alerts ?? [];

  return (
    <Sheet
      title={formatDateLong(day.work_date)}
      subtitle={<StatusBadge label={status.label} tone={status.tone} />}
      onClose={onClose}
    >
      <dl className="emp-kv">
        <div className="emp-kv__row">
          <dt>シフト</dt>
          <dd>{day.has_shift ? formatShiftText(day) : 'なし'}</dd>
        </div>
        <div className="emp-kv__row">
          <dt>勤務時間</dt>
          <dd className="emp-kv__strong">
            {day.working_hours ? formatHours(day.working_hours) : '-'}
          </dd>
        </div>
      </dl>

      {alerts.length > 0 && (
        <ul className="emp-alert emp-alert--warn emp-alert--list">
          {alerts.map((a, i) => (
            <li key={`${a.rule_id}-${i}`} className={a.is_acknowledged ? 'is-ack' : ''}>
              {a.message}
              {a.is_acknowledged && '（管理者確認済み）'}
            </li>
          ))}
        </ul>
      )}

      {isLocked && (
        <div className="emp-alert emp-alert--info">
          この月は締め処理が済んでいるため、修正申請や休憩の変更はできません。
        </div>
      )}

      {punches.length === 0 && (
        <p className="emp-note">
          {day.status === 'absence'
            ? 'この日はシフトがありましたが、打刻の記録がありません。勤務していた場合は、管理者に記録の追加を依頼してください。'
            : day.status === 'scheduled'
              ? 'まだ打刻の記録はありません。出勤したら打刻端末で打刻してください。'
              : 'この日の打刻の記録はありません。'}
        </p>
      )}

      {punches.map((p, idx) => {
        const pending = p.attendance_id ? pendingRequests.get(p.attendance_id) : undefined;
        const hasBreak = !!p.break_minutes && p.break_minutes > 0;
        const calcDiffers =
          (p.calculated_check_in && formatClock(p.calculated_check_in) !== formatClock(p.check_in)) ||
          (p.calculated_check_out &&
            formatClock(p.calculated_check_out) !== formatClock(p.check_out));
        return (
          <section key={p.attendance_id ?? idx} className="emp-punch">
            {punches.length > 1 && <h3 className="emp-punch__title">打刻 {idx + 1}</h3>}
            <div className="emp-punch__times">
              <div className="emp-punch__time">
                <span className="emp-punch__label">出勤</span>
                <span className="emp-punch__clock">{formatClock(p.check_in)}</span>
              </div>
              <div className="emp-punch__time">
                <span className="emp-punch__label">退勤</span>
                <span
                  className={`emp-punch__clock ${
                    !p.check_out && day.status === 'incomplete' ? 'emp-punch__clock--none' : ''
                  }`}
                >
                  {formatClock(p.check_out)}
                </span>
              </div>
            </div>

            <dl className="emp-kv emp-kv--small">
              {calcDiffers && (
                <div className="emp-kv__row">
                  <dt>計算上の勤務</dt>
                  <dd>
                    {formatClock(p.calculated_check_in)} 〜 {formatClock(p.calculated_check_out)}
                    {p.is_manual_work_time && '（管理者指定）'}
                  </dd>
                </div>
              )}
              <div className="emp-kv__row">
                <dt>打刻方法</dt>
                <dd>
                  {sourceLabel(p.source, p.device_name)}
                  {day.is_auto_completed && punches.length === 1 && '（退勤は自動補完）'}
                </dd>
              </div>
              {hasBreak && (
                <div className="emp-kv__row">
                  <dt>休憩</dt>
                  <dd>{p.break_minutes}分</dd>
                </div>
              )}
              {p.overtime_reason && (
                <div className="emp-kv__row">
                  <dt>超過理由</dt>
                  <dd>{p.overtime_reason}</dd>
                </div>
              )}
              {p.remarks && (
                <div className="emp-kv__row">
                  <dt>備考</dt>
                  <dd>{p.remarks}</dd>
                </div>
              )}
            </dl>

            {pending && (
              <div className="emp-pending">
                <div className="emp-pending__title">修正申請中（承認待ち）</div>
                <div className="emp-pending__body">
                  出勤 {formatClock(pending.requested_check_in, '未打刻')} ／ 退勤{' '}
                  {formatClock(pending.requested_check_out, '未打刻')}
                </div>
                <div className="emp-pending__reason">{pending.reason}</div>
                {!isLocked && (
                  <button
                    type="button"
                    className="emp-btn emp-btn--ghost-danger emp-btn--small"
                    disabled={busy}
                    onClick={() => onCancelRequest(pending)}
                  >
                    申請を取り消す
                  </button>
                )}
              </div>
            )}

            {p.attendance_id && (
              <div className="emp-punch__actions">
                {!isLocked && !pending && (
                  <button
                    type="button"
                    className="emp-btn emp-btn--primary"
                    disabled={busy}
                    onClick={() => onRequestCorrection(day, p)}
                  >
                    修正を申請する
                  </button>
                )}
                {!isLocked && (
                  <button
                    type="button"
                    className="emp-btn emp-btn--outline"
                    disabled={busy}
                    onClick={() => onToggleBreak(p)}
                  >
                    {hasBreak ? '休憩を取り消す' : '休憩60分を追加'}
                  </button>
                )}
                <button
                  type="button"
                  className="emp-btn emp-btn--outline"
                  onClick={() => onShowHistory(p.attendance_id!, day.work_date)}
                >
                  変更履歴
                </button>
              </div>
            )}
          </section>
        );
      })}
    </Sheet>
  );
}
