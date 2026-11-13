import type { AttendanceCorrectionRequest, DailyAttendanceDetail } from '../../types/attendance';
import { formatHours } from '../../utils/time';
import {
  WEEKDAYS,
  formatClock,
  formatShiftText,
  getPunches,
  parseWorkDate,
  statusInfo,
  type StatusTone,
} from './empUtils';
import { ChevronRightIcon } from './icons';

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={`emp-badge emp-badge--${tone}`}>{label}</span>;
}

interface Props {
  day: DailyAttendanceDetail;
  isToday: boolean;
  pendingRequests: Map<string, AttendanceCorrectionRequest>;
  /** 月をまたいで並べるときに「11/」のように月も表示する。 */
  showMonth?: boolean;
  onSelect: (day: DailyAttendanceDetail) => void;
}

/** 1日分を1行にまとめた表示。タップで詳細を開く。 */
export function DayRow({ day, isToday, pendingRequests, showMonth = false, onSelect }: Props) {
  const date = parseWorkDate(day.work_date);
  const weekday = date.getDay();
  const punches = getPunches(day);
  const status = statusInfo(day.status);
  const hasPending = punches.some((p) => p.attendance_id && pendingRequests.has(p.attendance_id));
  const alertCount = (day.daily_alerts ?? []).filter((a) => !a.is_acknowledged).length;

  let timesText: string;
  if (punches.length === 0) {
    timesText = day.status === 'absence' ? '打刻なし' : day.has_shift ? '未打刻' : '—';
  } else {
    const first = punches[0];
    timesText = `${formatClock(first.check_in)} – ${formatClock(first.check_out)}`;
  }

  const weekdayClass =
    weekday === 0 || day.is_holiday ? 'emp-day__wd--sun' : weekday === 6 ? 'emp-day__wd--sat' : '';

  return (
    <button
      type="button"
      className={`emp-day ${isToday ? 'emp-day--today' : ''}`}
      onClick={() => onSelect(day)}
    >
      <span className="emp-day__date">
        <span className="emp-day__num">
          {showMonth && <span className="emp-day__month">{date.getMonth() + 1}/</span>}
          {date.getDate()}
        </span>
        <span className={`emp-day__wd ${weekdayClass}`}>{isToday ? '今日' : WEEKDAYS[weekday]}</span>
      </span>
      <span className="emp-day__main">
        <span className={`emp-day__times ${punches.length === 0 ? 'emp-day__times--none' : ''}`}>
          {timesText}
          {punches.length > 1 && <span className="emp-day__more">ほか{punches.length - 1}件</span>}
        </span>
        <span className="emp-day__sub">
          {day.has_shift ? `シフト ${formatShiftText(day)}` : 'シフトなし'}
        </span>
        {(hasPending || alertCount > 0) && (
          <span className="emp-day__flags">
            {hasPending && <span className="emp-flag emp-flag--pending">修正申請中</span>}
            {alertCount > 0 && <span className="emp-flag emp-flag--alert">要確認 {alertCount}</span>}
          </span>
        )}
      </span>
      <span className="emp-day__side">
        <span className="emp-day__hours">
          {day.working_hours ? formatHours(day.working_hours) : ''}
        </span>
        <StatusBadge label={status.label} tone={status.tone} />
      </span>
      <span className="emp-day__chev">
        <ChevronRightIcon size={18} />
      </span>
    </button>
  );
}
