import { useEffect, useMemo, useState } from 'react';
import type {
  AlertResult,
  AttendanceCorrectionRequest,
  DailyAttendanceDetail,
} from '../../types/attendance';
import { formatHours } from '../../utils/time';
import { DayRow } from './DayRow';
import {
  formatDateShort,
  formatShiftText,
  getPunches,
  parseWorkDate,
  toDateStr,
} from './empUtils';
import { ChevronDownIcon } from './icons';
import { MonthSwitcher } from './MonthSwitcher';
import type { EmployeeData } from './useEmployeeData';

interface Props {
  data: EmployeeData;
  today: string;
  yearMonth: string;
  onChangeMonth: (yearMonth: string) => void;
  pendingRequests: Map<string, AttendanceCorrectionRequest>;
  onSelectDay: (day: DailyAttendanceDetail) => void;
  onOpenEditLog: () => void;
}

interface WeekGroup {
  key: string;
  /** 週の月曜日（YYYY-MM-DD）。 */
  weekStart: string;
  days: DailyAttendanceDetail[];
  workingDays: number;
  hours: number;
  alerts: AlertResult[];
}

const ORDER_KEY = 'kint_emp_records_order';
const SHOW_ALL_KEY = 'kint_emp_records_show_all';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても表示には影響しない
  }
}

function mondayOf(workDate: string): string {
  const d = parseWorkDate(workDate);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toDateStr(d);
}

/** 月曜始まりの週ごとにまとめ、週の勤務日数・時間を集計する。 */
function groupByWeek(days: DailyAttendanceDetail[]): WeekGroup[] {
  const groups: WeekGroup[] = [];
  for (const day of days) {
    const weekStart = mondayOf(day.work_date);
    let group = groups[groups.length - 1];
    if (!group || group.weekStart !== weekStart) {
      group = { key: weekStart, weekStart, days: [], workingDays: 0, hours: 0, alerts: [] };
      groups.push(group);
    }
    group.days.push(day);
    if (getPunches(day).length > 0) group.workingDays += 1;
    if (day.working_hours) group.hours += day.working_hours;
    if (day.weekly_alerts && day.weekly_alerts.length > 0) {
      group.alerts.push(...day.weekly_alerts);
    }
  }
  return groups;
}

/** 勤怠タブ: 月ごとの記録を、今日に近い日から1日1行で並べる。 */
export function RecordsTab({
  data,
  today,
  yearMonth,
  onChangeMonth,
  pendingRequests,
  onSelectDay,
  onOpenEditLog,
}: Props) {
  const { getMonth, ensureMonth, refreshMonth } = data;
  const month = getMonth(yearMonth);
  const currentYm = today.slice(0, 7);

  const [newestFirst, setNewestFirst] = useState(() => readPref(ORDER_KEY) !== 'asc');
  const [showAll, setShowAll] = useState(() => readPref(SHOW_ALL_KEY) === '1');
  const [showUpcoming, setShowUpcoming] = useState(false);

  useEffect(() => {
    ensureMonth(yearMonth);
  }, [ensureMonth, yearMonth]);

  const days = useMemo(() => month.data?.days ?? [], [month.data]);
  const isFutureMonth = yearMonth > currentYm;

  const upcoming = useMemo(
    () => days.filter((d) => d.work_date > today && d.has_shift),
    [days, today],
  );

  const groups = useMemo(() => {
    const all = groupByWeek(days);
    const visible = all
      .map((g) => ({
        ...g,
        days: g.days.filter((d) => {
          if (d.work_date > today) return false;
          if (showAll || d.work_date === today) return true;
          return d.has_shift || getPunches(d).length > 0;
        }),
      }))
      .filter((g) => g.days.length > 0);
    if (!newestFirst) return visible;
    return visible.reverse().map((g) => ({ ...g, days: [...g.days].reverse() }));
  }, [days, today, showAll, newestFirst]);

  const summary = month.data?.summary ?? null;
  const thisWeek = mondayOf(today);

  const weekLabel = (g: WeekGroup): string => {
    if (g.weekStart === thisWeek) return '今週';
    const first = g.days[newestFirst ? g.days.length - 1 : 0];
    const last = g.days[newestFirst ? 0 : g.days.length - 1];
    const from = parseWorkDate(first.work_date);
    const to = parseWorkDate(last.work_date);
    return from.getTime() === to.getTime()
      ? `${from.getMonth() + 1}/${from.getDate()}`
      : `${from.getMonth() + 1}/${from.getDate()}〜${to.getDate()}`;
  };

  return (
    <div className="emp-page">
      <header className="emp-page__head">
        <h1 className="emp-page__title">勤怠の記録</h1>
      </header>

      <MonthSwitcher yearMonth={yearMonth} currentYearMonth={currentYm} onChange={onChangeMonth} />

      {month.error && (
        <div className="emp-alert emp-alert--danger" role="alert">
          {month.error}
          <button type="button" className="emp-link" onClick={() => void refreshMonth(yearMonth)}>
            再読み込み
          </button>
        </div>
      )}

      {month.data?.is_locked && (
        <div className="emp-alert emp-alert--info">
          この月は締め処理が済んでいるため、修正申請はできません。
        </div>
      )}

      {summary && (
        <div className="emp-stats emp-stats--compact">
          <div className="emp-stat">
            <span className="emp-stat__label">出勤日数</span>
            <span className="emp-stat__value">
              {summary.working_days}
              <small> / {summary.prescribed_days}日</small>
            </span>
          </div>
          <div className="emp-stat">
            <span className="emp-stat__label">申請勤務時間</span>
            <span className="emp-stat__value">{formatHours(summary.total_requested_hours)}</span>
            <span className="emp-stat__note">実時間 {formatHours(summary.total_working_hours)}</span>
          </div>
          <div className="emp-stat">
            <span className="emp-stat__label">打刻もれ</span>
            <span
              className={`emp-stat__value ${summary.incomplete_days > 0 ? 'emp-stat__value--danger' : ''}`}
            >
              {summary.incomplete_days}
              <small> 件</small>
            </span>
          </div>
        </div>
      )}

      <div className="emp-toolbar">
        <button
          type="button"
          className="emp-chip"
          aria-pressed={newestFirst}
          onClick={() => {
            const nextValue = !newestFirst;
            setNewestFirst(nextValue);
            writePref(ORDER_KEY, nextValue ? 'desc' : 'asc');
          }}
        >
          {newestFirst ? '新しい順 ↓' : '古い順 ↑'}
        </button>
        <button
          type="button"
          className={`emp-chip ${showAll ? 'emp-chip--on' : ''}`}
          aria-pressed={showAll}
          onClick={() => {
            const nextValue = !showAll;
            setShowAll(nextValue);
            writePref(SHOW_ALL_KEY, nextValue ? '1' : '0');
          }}
        >
          休みの日も表示
        </button>
        <button type="button" className="emp-chip" onClick={onOpenEditLog}>
          編集ログ
        </button>
      </div>

      {upcoming.length > 0 && (
        <section className="emp-section">
          {isFutureMonth ? (
            <h2 className="emp-section__title">シフトの予定（{upcoming.length}件）</h2>
          ) : (
            <button
              type="button"
              className="emp-disclosure"
              aria-expanded={showUpcoming}
              onClick={() => setShowUpcoming((v) => !v)}
            >
              <span>今後のシフト（{upcoming.length}件）</span>
              <span className={`emp-disclosure__icon ${showUpcoming ? 'emp-disclosure__icon--open' : ''}`}>
                <ChevronDownIcon size={18} />
              </span>
            </button>
          )}
          {(isFutureMonth || showUpcoming) && (
            <div className="emp-card emp-card--list">
              {upcoming.map((d) => (
                <div key={d.work_date} className="emp-shift">
                  <span className="emp-shift__date">{formatDateShort(d.work_date)}</span>
                  <span className="emp-shift__time">{formatShiftText(d)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {month.loading && !month.data ? (
        <div className="emp-skeleton emp-skeleton--list" />
      ) : groups.length === 0 ? (
        !isFutureMonth && month.data && <p className="emp-empty">この月の勤務記録はありません。</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="emp-section emp-week">
            <div className="emp-week__head">
              <span className="emp-week__label">{weekLabel(g)}</span>
              <span className="emp-week__total">
                勤務 {g.workingDays}日{g.hours > 0 && ` ・ ${formatHours(g.hours)}`}
              </span>
            </div>
            {g.alerts.length > 0 && (
              <ul className="emp-week__alerts">
                {g.alerts.map((a, i) => (
                  <li key={`${a.rule_id}-${i}`} className={a.is_acknowledged ? 'is-ack' : ''}>
                    {a.message}
                    {a.is_acknowledged && '（確認済み）'}
                  </li>
                ))}
              </ul>
            )}
            <div className="emp-card emp-card--list">
              {g.days.map((d) => (
                <DayRow
                  key={d.work_date}
                  day={d}
                  isToday={d.work_date === today}
                  pendingRequests={pendingRequests}
                  onSelect={onSelectDay}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
