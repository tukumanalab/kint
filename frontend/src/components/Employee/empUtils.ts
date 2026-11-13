import type {
  AttendanceCorrectionRequest,
  DailyAttendanceDetail,
  DailyAttendanceStatus,
  PunchPeriod,
} from '../../types/attendance';
import { parseUtcDate } from '../../utils/time';

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** Date から YYYY-MM-DD（ローカル時刻）を作る。 */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function currentYearMonth(): string {
  return todayStr().slice(0, 7);
}

/** YYYY-MM に月数を加減する。 */
export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${y}年${m}月`;
}

/** YYYY-MM-DD をローカル時刻の Date に変換する（UTC 解釈による日付ずれを避ける）。 */
export function parseWorkDate(workDate: string): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekdayOf(workDate: string): number {
  return parseWorkDate(workDate).getDay();
}

/** 「11月12日(木)」形式。 */
export function formatDateLong(workDate: string): string {
  const d = parseWorkDate(workDate);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

/** 「11/12(木)」形式。 */
export function formatDateShort(workDate: string): string {
  const d = parseWorkDate(workDate);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** naive UTC の ISO 文字列を端末のローカル時刻「HH:MM」にする。値がなければ fallback。 */
export function formatClock(iso: string | null | undefined, fallback = '--:--'): string {
  if (!iso) return fallback;
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return fallback;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 「2026/11/12 12:52」形式。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${formatClock(iso)}`;
}

/** 「3分前」「2日前」などの相対表記。 */
export function formatRelative(iso: string): string {
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 1日分のデータから打刻（出勤〜退勤の組）の一覧を取り出す。 */
export function getPunches(day: DailyAttendanceDetail): PunchPeriod[] {
  if (day.punches && day.punches.length > 0) return day.punches;
  if (day.attendance_id || day.check_in || day.check_out) {
    return [
      {
        attendance_id: day.attendance_id,
        check_in: day.check_in,
        check_out: day.check_out,
        calculated_check_in: day.calculated_check_in,
        calculated_check_out: day.calculated_check_out,
        source: day.source,
        device_name: day.device_name,
        is_manual_work_time: day.is_manual_work_time,
        break_minutes: day.break_minutes,
        remarks: day.remarks,
      },
    ];
  }
  return [];
}

export function getShifts(day: DailyAttendanceDetail): { start: string; end: string }[] {
  if (day.shifts && day.shifts.length > 0) {
    return day.shifts.map((s) => ({ start: s.start_time, end: s.end_time }));
  }
  if (day.has_shift && day.shift_start && day.shift_end) {
    return [{ start: day.shift_start, end: day.shift_end }];
  }
  return [];
}

export function formatShiftText(day: DailyAttendanceDetail): string {
  const shifts = getShifts(day);
  if (shifts.length === 0) return 'シフトなし';
  return shifts.map((s) => `${formatClock(s.start)}〜${formatClock(s.end)}`).join(' / ');
}

export type StatusTone = 'ok' | 'info' | 'warn' | 'danger' | 'muted';

export function statusInfo(status: DailyAttendanceStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'normal':
      return { label: '正常', tone: 'ok' };
    case 'late':
      return { label: '遅刻', tone: 'warn' };
    case 'early_leave':
      return { label: '早退', tone: 'warn' };
    case 'late_and_early':
      return { label: '遅刻・早退', tone: 'warn' };
    case 'absence':
      return { label: '欠勤', tone: 'danger' };
    case 'incomplete':
      return { label: '打刻もれ', tone: 'danger' };
    case 'scheduled':
      return { label: '出勤予定', tone: 'info' };
    case 'working':
      return { label: '勤務中', tone: 'info' };
    case 'off_duty':
      return { label: '休み', tone: 'muted' };
    default:
      return { label: String(status), tone: 'muted' };
  }
}

export function sourceLabel(source: string | null | undefined, deviceName?: string | null): string {
  let label: string;
  switch (source) {
    case 'webusb_nfc':
      label = 'NFCカード';
      break;
    case 'web_user_id':
      label = 'ID入力';
      break;
    case 'webcam_face':
      label = '顔認証';
      break;
    case 'admin_manual':
      label = '管理者修正';
      break;
    case 'self_service':
      label = '修正申請';
      break;
    default:
      label = source || '-';
  }
  return deviceName ? `${label}（${deviceName}）` : label;
}

/** ISO 文字列を <input type="date"> / <input type="time"> 用の値に分解する。 */
export function toLocalParts(
  iso: string | null | undefined,
  fallbackDate: string,
): { date: string; time: string } {
  if (!iso) return { date: fallbackDate, time: '' };
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return { date: fallbackDate, time: '' };
  return { date: toDateStr(d), time: formatClock(iso) };
}

/** ローカルの日付・時刻入力値を UTC の ISO 文字列にする。どちらかが空なら null。 */
export function toIsoFromLocal(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const date = new Date(y, m - 1, d, hh, mm);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * 打刻時刻から丸め後の勤務時間（時間）を見積もる。
 * 出勤はシフト開始前ならシフト開始、以降は5分切り捨て。退勤はシフト終了後ならシフト終了、以前は5分切り上げ。
 */
export function estimateWorkingHours(
  checkIn: Date | null,
  checkOut: Date | null,
  shiftStartIso: string | null | undefined,
  shiftEndIso: string | null | undefined,
): number {
  if (!checkIn || !checkOut) return 0;
  const shiftStart = shiftStartIso ? parseUtcDate(shiftStartIso) : null;
  const shiftEnd = shiftEndIso ? parseUtcDate(shiftEndIso) : null;

  let calcIn = new Date(checkIn.getTime());
  calcIn.setSeconds(0, 0);
  if (shiftStart && calcIn.getTime() <= shiftStart.getTime()) {
    calcIn = shiftStart;
  } else {
    calcIn.setMinutes(Math.floor(calcIn.getMinutes() / 5) * 5);
  }

  let calcOut = new Date(checkOut.getTime());
  calcOut.setSeconds(0, 0);
  if (shiftEnd && calcOut.getTime() >= shiftEnd.getTime()) {
    calcOut = shiftEnd;
  } else {
    const rounded = Math.ceil(calcOut.getMinutes() / 5) * 5;
    if (rounded === 60) {
      calcOut.setHours(calcOut.getHours() + 1);
      calcOut.setMinutes(0);
    } else {
      calcOut.setMinutes(rounded);
    }
  }

  const ms = calcOut.getTime() - calcIn.getTime();
  return ms > 0 ? ms / 3600000 : 0;
}

/** 勤怠 ID ごとの承認待ち申請を引けるようにする。 */
export function indexPendingRequests(
  requests: AttendanceCorrectionRequest[],
): Map<string, AttendanceCorrectionRequest> {
  const map = new Map<string, AttendanceCorrectionRequest>();
  for (const r of requests) {
    if (r.status === 'pending') map.set(r.attendance_id, r);
  }
  return map;
}

/** その日に対応が必要か（打刻もれ・未確認のアラートではなく、本人が動く必要があるもの）。 */
export function needsAction(day: DailyAttendanceDetail, today: string): boolean {
  if (day.work_date >= today) return false;
  return day.status === 'incomplete';
}
