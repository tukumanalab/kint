import { useMemo, useState } from 'react';
import { createCorrectionRequest } from '../../api/attendance';
import type { DailyAttendanceDetail, PunchPeriod } from '../../types/attendance';
import { formatHours, parseUtcDate } from '../../utils/time';
import {
  estimateWorkingHours,
  formatClock,
  formatDateLong,
  getShifts,
  toIsoFromLocal,
  toLocalParts,
} from './empUtils';
import { Sheet } from './Sheet';

interface Props {
  token: string;
  day: DailyAttendanceDetail;
  punch: PunchPeriod;
  onClose: () => void;
  onSubmitted: () => void;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** 打刻の修正申請フォーム。時刻は端末標準の入力欄で選ぶ。 */
export function CorrectionSheet({ token, day, punch, onClose, onSubmitted }: Props) {
  const initialIn = useMemo(
    () => toLocalParts(punch.check_in, day.work_date),
    [punch.check_in, day.work_date],
  );
  const initialOut = useMemo(
    () => toLocalParts(punch.check_out, day.work_date),
    [punch.check_out, day.work_date],
  );

  const [inDate, setInDate] = useState(initialIn.date);
  const [inTime, setInTime] = useState(initialIn.time);
  const [outDate, setOutDate] = useState(initialOut.date);
  const [outTime, setOutTime] = useState(initialOut.time);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const shifts = getShifts(day);
  const shiftStart = shifts[0]?.start ?? day.shift_start;
  const shiftEnd = shifts[shifts.length - 1]?.end ?? day.shift_end;

  const isoIn = toIsoFromLocal(inDate, inTime);
  const isoOut = toIsoFromLocal(outDate, outTime);

  const beforeHours =
    punch.calculated_check_in && punch.calculated_check_out
      ? Math.max(
          0,
          (parseUtcDate(punch.calculated_check_out).getTime() -
            parseUtcDate(punch.calculated_check_in).getTime()) /
            3600000,
        )
      : 0;
  const afterHours = estimateWorkingHours(
    isoIn ? new Date(isoIn) : null,
    isoOut ? new Date(isoOut) : null,
    shiftStart,
    shiftEnd,
  );
  const diffHours = afterHours - beforeHours;
  const crossesDay = !!inDate && !!outDate && inDate !== outDate;
  const unchanged =
    inDate === initialIn.date &&
    inTime === initialIn.time &&
    outDate === initialOut.date &&
    outTime === initialOut.time;

  const handleSubmit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError('修正の理由を入力してください。');
      return;
    }
    if (isoIn && isoOut) {
      const inMs = new Date(isoIn).getTime();
      const outMs = new Date(isoOut).getTime();
      if (inMs >= outMs) {
        setError('退勤は出勤より後の時刻にしてください。');
        return;
      }
      if (outMs - inMs <= FIVE_MINUTES_MS) {
        setError('出勤から5分以内の退勤への修正は申請できません。');
        return;
      }
      const hours = (outMs - inMs) / 3600000;
      if (
        hours >= 24 &&
        !window.confirm(
          `出勤から退勤まで ${hours.toFixed(1)} 時間あります。\nこの日時で申請してよろしいですか？`,
        )
      ) {
        return;
      }
    }

    setSubmitting(true);
    try {
      await createCorrectionRequest(token, {
        attendance_id: punch.attendance_id!,
        requested_check_in: isoIn,
        requested_check_out: isoOut,
        reason: reason.trim(),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      tall
      title="打刻の修正申請"
      subtitle={formatDateLong(day.work_date)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="emp-btn emp-btn--outline" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="emp-btn emp-btn--primary emp-btn--grow"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? '送信中…' : '申請する'}
          </button>
        </>
      }
    >
      <div className="emp-form-current">
        <span className="emp-form-current__label">いまの記録</span>
        <span className="emp-form-current__value">
          {formatClock(punch.check_in)} → {formatClock(punch.check_out)}
        </span>
        {shifts.length > 0 && (
          <span className="emp-form-current__shift">
            シフト {formatClock(shiftStart)}〜{formatClock(shiftEnd)}
          </span>
        )}
      </div>

      <fieldset className="emp-field">
        <legend className="emp-field__label">正しい出勤時刻</legend>
        <div className="emp-datetime">
          <input
            type="date"
            className="emp-input emp-input--date"
            aria-label="出勤日"
            value={inDate}
            onChange={(e) => setInDate(e.target.value)}
          />
          <input
            type="time"
            className="emp-input emp-input--time"
            aria-label="出勤時刻"
            value={inTime}
            onChange={(e) => setInTime(e.target.value)}
          />
        </div>
        <div className="emp-field__tools">
          {shiftStart && (
            <button
              type="button"
              className="emp-chip"
              onClick={() => {
                const parts = toLocalParts(shiftStart, day.work_date);
                setInDate(parts.date);
                setInTime(parts.time);
              }}
            >
              シフト開始 {formatClock(shiftStart)}
            </button>
          )}
          <button type="button" className="emp-chip" onClick={() => setInTime('')}>
            空欄にする
          </button>
        </div>
      </fieldset>

      <fieldset className="emp-field">
        <legend className="emp-field__label">正しい退勤時刻</legend>
        <div className="emp-datetime">
          <input
            type="date"
            className="emp-input emp-input--date"
            aria-label="退勤日"
            value={outDate}
            onChange={(e) => setOutDate(e.target.value)}
          />
          <input
            type="time"
            className="emp-input emp-input--time"
            aria-label="退勤時刻"
            value={outTime}
            onChange={(e) => setOutTime(e.target.value)}
          />
        </div>
        <div className="emp-field__tools">
          {shiftEnd && (
            <button
              type="button"
              className="emp-chip"
              onClick={() => {
                const parts = toLocalParts(shiftEnd, day.work_date);
                setOutDate(parts.date);
                setOutTime(parts.time);
              }}
            >
              シフト終了 {formatClock(shiftEnd)}
            </button>
          )}
          <button type="button" className="emp-chip" onClick={() => setOutTime('')}>
            空欄にする
          </button>
        </div>
        {crossesDay && (
          <div className="emp-alert emp-alert--warn">
            退勤日が出勤日と違います（日またぎ）。
            <button type="button" className="emp-link" onClick={() => setOutDate(inDate)}>
              出勤日と同じ日にする
            </button>
          </div>
        )}
      </fieldset>

      <div className="emp-preview">
        <div className="emp-preview__row">
          <span>申請後の勤務時間（目安）</span>
          <strong>
            {formatHours(afterHours)}
            <span
              className={`emp-diff ${diffHours > 0 ? 'emp-diff--plus' : diffHours < 0 ? 'emp-diff--minus' : ''}`}
            >
              {diffHours > 0
                ? `+${formatHours(diffHours)}`
                : diffHours < 0
                  ? formatHours(diffHours)
                  : '±0:00'}
            </span>
          </strong>
        </div>
        {(!isoIn || !isoOut) && (
          <p className="emp-preview__warn">
            出勤か退勤が空欄のままだと「打刻もれ」（勤務時間 0:00）として扱われます。
          </p>
        )}
        {unchanged && <p className="emp-preview__hint">時刻がまだ変更されていません。</p>}
      </div>

      <div className="emp-field">
        <label className="emp-field__label" htmlFor="emp-correction-reason">
          修正の理由 <span className="emp-required">必須</span>
        </label>
        <textarea
          id="emp-correction-reason"
          className="emp-input emp-textarea"
          rows={3}
          placeholder="例: 退勤時にカードをかざし忘れました"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {error && (
        <div className="emp-alert emp-alert--danger" role="alert">
          {error}
        </div>
      )}
    </Sheet>
  );
}
