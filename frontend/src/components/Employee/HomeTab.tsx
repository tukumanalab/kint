import { useEffect, useMemo } from 'react';
import type { AttendanceCorrectionRequest, DailyAttendanceDetail } from '../../types/attendance';
import { formatHours } from '../../utils/time';
import { DayRow, StatusBadge } from './DayRow';
import {
  addMonths,
  formatClock,
  formatDateLong,
  formatDateShort,
  formatShiftText,
  formatYearMonth,
  getPunches,
  needsAction,
  statusInfo,
} from './empUtils';
import { ChevronRightIcon } from './icons';
import type { EmployeeData } from './useEmployeeData';

interface Props {
  data: EmployeeData;
  today: string;
  userName: string;
  pendingRequests: Map<string, AttendanceCorrectionRequest>;
  onSelectDay: (day: DailyAttendanceDetail) => void;
  onOpenRecords: () => void;
  onOpenRequests: () => void;
}

const RECENT_LIMIT = 5;

/** ホーム: 今日の記録を最初に見せ、対応が必要なことと最近の勤務をまとめる。 */
export function HomeTab({
  data,
  today,
  userName,
  pendingRequests,
  onSelectDay,
  onOpenRecords,
  onOpenRequests,
}: Props) {
  const yearMonth = today.slice(0, 7);
  const prevMonth = addMonths(yearMonth, -1);
  const nextMonth = addMonths(yearMonth, 1);
  const { getMonth, ensureMonth, refreshMonth } = data;

  const current = getMonth(yearMonth);
  const prev = getMonth(prevMonth);
  const next = getMonth(nextMonth);

  useEffect(() => {
    ensureMonth(yearMonth);
    ensureMonth(prevMonth);
  }, [ensureMonth, yearMonth, prevMonth]);

  const days = useMemo(() => current.data?.days ?? [], [current.data]);
  const todayData = days.find((d) => d.work_date === today) ?? null;

  const upcomingInMonth = useMemo(
    () => days.filter((d) => d.work_date > today && d.has_shift),
    [days, today],
  );

  // 月末でこの先のシフトが当月にないときだけ、翌月を取りにいく
  useEffect(() => {
    if (current.data && upcomingInMonth.length === 0) {
      ensureMonth(nextMonth);
    }
  }, [current.data, upcomingInMonth.length, ensureMonth, nextMonth]);

  const upcoming = useMemo(() => {
    const list = [...upcomingInMonth];
    if (list.length < 3 && next.data) {
      list.push(...next.data.days.filter((d) => d.has_shift));
    }
    return list.slice(0, 3);
  }, [upcomingInMonth, next.data]);

  const pastDays = useMemo(() => {
    const prevDays = prev.data?.days ?? [];
    return [...prevDays, ...days].filter((d) => d.work_date < today);
  }, [prev.data, days, today]);

  const recent = useMemo(
    () =>
      pastDays
        .filter((d) => getPunches(d).length > 0 || d.has_shift)
        .sort((a, b) => (a.work_date < b.work_date ? 1 : -1))
        .slice(0, RECENT_LIMIT),
    [pastDays],
  );

  const actionDays = useMemo(() => {
    const prevLocked = prev.data?.is_locked ?? true;
    const curLocked = current.data?.is_locked ?? false;
    return pastDays
      .filter((d) => needsAction(d, today))
      .filter((d) => (d.work_date.startsWith(yearMonth) ? !curLocked : !prevLocked))
      .sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
  }, [pastDays, prev.data, current.data, today, yearMonth]);

  // 上の「打刻もれ」の行で案内済みの申請は、件数の行では重ねて数えない
  const pendingCount = useMemo(() => {
    const shown = new Set<string>();
    for (const d of actionDays) {
      for (const p of getPunches(d)) {
        if (p.attendance_id && pendingRequests.has(p.attendance_id)) shown.add(p.attendance_id);
      }
    }
    return pendingRequests.size - shown.size;
  }, [actionDays, pendingRequests]);
  const summary = current.data?.summary ?? null;

  const renderToday = () => {
    if (!todayData) {
      if (current.loading) return <div className="emp-skeleton emp-skeleton--today" />;
      return <p className="emp-muted">今日の記録を読み込めませんでした。</p>;
    }
    const punches = getPunches(todayData);
    const status = statusInfo(todayData.status);
    const last = punches[punches.length - 1];
    const headline =
      punches.length === 0
        ? todayData.has_shift
          ? 'まだ出勤の打刻がありません'
          : '今日はシフトがありません'
        : last.check_out
          ? '退勤済みです'
          : '勤務中です';

    return (
      <button type="button" className="emp-today" onClick={() => onSelectDay(todayData)}>
        <div className="emp-today__top">
          <span className="emp-today__headline">{headline}</span>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
        <div className="emp-today__times">
          <div className="emp-today__time">
            <span className="emp-today__label">出勤</span>
            <span className="emp-today__clock">{formatClock(punches[0]?.check_in)}</span>
          </div>
          <div className="emp-today__sep" aria-hidden="true">
            →
          </div>
          <div className="emp-today__time">
            <span className="emp-today__label">退勤</span>
            <span className="emp-today__clock">{formatClock(last?.check_out)}</span>
          </div>
          <div className="emp-today__time emp-today__time--hours">
            <span className="emp-today__label">勤務時間</span>
            <span className="emp-today__clock">
              {todayData.working_hours ? formatHours(todayData.working_hours) : '-:--'}
            </span>
          </div>
        </div>
        <div className="emp-today__foot">
          <span>
            {todayData.has_shift ? `シフト ${formatShiftText(todayData)}` : 'シフトなし'}
            {punches.length > 1 && ` ・ 打刻 ${punches.length}回`}
          </span>
          <span className="emp-today__link">
            詳細
            <ChevronRightIcon size={16} />
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="emp-page">
      <header className="emp-page__head">
        <p className="emp-page__eyebrow">{userName} さん</p>
        <h1 className="emp-page__title">{formatDateLong(today)}</h1>
      </header>

      {current.error && (
        <div className="emp-alert emp-alert--danger" role="alert">
          {current.error}
          <button type="button" className="emp-link" onClick={() => void refreshMonth(yearMonth)}>
            再読み込み
          </button>
        </div>
      )}

      <section className="emp-section" aria-label="今日の記録">
        {renderToday()}
      </section>

      {(actionDays.length > 0 || pendingCount > 0) && (
        <section className="emp-section">
          <h2 className="emp-section__title">確認してください</h2>
          <div className="emp-card emp-card--list">
            {actionDays.map((d) => {
              const applied = getPunches(d).some(
                (p) => p.attendance_id && pendingRequests.has(p.attendance_id),
              );
              return (
                <button
                  key={d.work_date}
                  type="button"
                  className="emp-todo"
                  onClick={() => onSelectDay(d)}
                >
                  <span className={`emp-todo__dot ${applied ? 'emp-todo__dot--done' : ''}`} />
                  <span className="emp-todo__text">
                    <strong>{formatDateShort(d.work_date)}</strong>
                    {applied
                      ? ' 修正申請中です（承認待ち）'
                      : ' 打刻もれがあります。修正申請をしてください'}
                  </span>
                  <ChevronRightIcon size={18} />
                </button>
              );
            })}
            {pendingCount > 0 && (
              <button type="button" className="emp-todo" onClick={onOpenRequests}>
                <span className="emp-todo__dot emp-todo__dot--info" />
                <span className="emp-todo__text">
                  {actionDays.length > 0 ? 'ほかに承認待ちの修正申請が ' : '承認待ちの修正申請が '}
                  <strong>{pendingCount}件</strong> あります
                </span>
                <ChevronRightIcon size={18} />
              </button>
            )}
          </div>
        </section>
      )}

      <section className="emp-section">
        <h2 className="emp-section__title">{formatYearMonth(yearMonth)}のまとめ</h2>
        {summary ? (
          <div className="emp-stats">
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
              <span className="emp-stat__label">4月からの累計</span>
              <span className="emp-stat__value">{formatHours(summary.yearly_working_hours)}</span>
            </div>
          </div>
        ) : (
          <div className="emp-skeleton emp-skeleton--stats" />
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="emp-section">
          <h2 className="emp-section__title">次のシフト</h2>
          <div className="emp-card emp-card--list">
            {upcoming.map((d) => (
              <div key={d.work_date} className="emp-shift">
                <span className="emp-shift__date">{formatDateShort(d.work_date)}</span>
                <span className="emp-shift__time">{formatShiftText(d)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="emp-section">
        <div className="emp-section__head">
          <h2 className="emp-section__title">最近の勤務</h2>
          <button type="button" className="emp-link" onClick={onOpenRecords}>
            すべて見る
          </button>
        </div>
        {recent.length > 0 ? (
          <div className="emp-card emp-card--list">
            {recent.map((d) => (
              <DayRow
                key={d.work_date}
                day={d}
                isToday={false}
                showMonth
                pendingRequests={pendingRequests}
                onSelect={onSelectDay}
              />
            ))}
          </div>
        ) : current.loading ? (
          <div className="emp-skeleton emp-skeleton--list" />
        ) : (
          <p className="emp-empty">最近の勤務記録はありません。</p>
        )}
      </section>
    </div>
  );
}
