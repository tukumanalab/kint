import { useCallback, useEffect, useMemo, useState } from 'react';
import { cancelCorrectionRequest, updateAttendanceBreak } from '../../api/attendance';
import type { UseAuth } from '../../hooks/useAuth';
import type {
  AttendanceCorrectionRequest,
  DailyAttendanceDetail,
  PunchPeriod,
} from '../../types/attendance';
import type { Notification } from '../../types/notification';
import { MyProfilePage } from '../MyProfile';
import { CorrectionSheet } from './CorrectionSheet';
import { DaySheet } from './DaySheet';
import { indexPendingRequests, todayStr } from './empUtils';
import { HelpTab } from './HelpTab';
import { HistorySheet } from './HistorySheet';
import { HomeTab } from './HomeTab';
import { BellIcon, CalendarIcon, HelpIcon, HomeIcon, RequestIcon, UserIcon } from './icons';
import { NotificationSheet } from './NotificationSheet';
import { RecordsTab } from './RecordsTab';
import { RequestsTab, type RequestsView } from './RequestsTab';
import { useEmployeeData } from './useEmployeeData';
import './EmployeeApp.css';

type EmpTab = 'home' | 'records' | 'requests' | 'help' | 'me';

const TAB_PATHS: Record<EmpTab, string> = {
  home: '',
  records: 'records',
  requests: 'requests',
  help: 'help',
  me: 'me',
};

const TABS: { key: EmpTab; label: string; Icon: typeof HomeIcon }[] = [
  { key: 'home', label: 'ホーム', Icon: HomeIcon },
  { key: 'records', label: '勤怠', Icon: CalendarIcon },
  { key: 'requests', label: '申請', Icon: RequestIcon },
  { key: 'help', label: 'ヘルプ', Icon: HelpIcon },
  { key: 'me', label: 'マイページ', Icon: UserIcon },
];

function basePath(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** 現在の URL からタブを判定する。該当しないパスはホーム扱い。 */
function tabFromLocation(): EmpTab {
  const base = basePath();
  const path = window.location.pathname;
  const rest = (path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '')).replace(
    /\/$/,
    '',
  );
  const found = (Object.keys(TAB_PATHS) as EmpTab[]).find((k) => TAB_PATHS[k] === rest);
  return found ?? 'home';
}

interface Props {
  auth: UseAuth;
  siteName: string;
  notifications: Notification[];
  unreadCount: number;
  onReadNotification: (id: string) => Promise<void>;
  onReadAllNotifications: () => Promise<void>;
}

/** 従業員向けの画面一式。スマートフォンでの利用を前提に、下部タブで切り替える。 */
export function EmployeeApp({
  auth,
  siteName,
  notifications,
  unreadCount,
  onReadNotification,
  onReadAllNotifications,
}: Props) {
  const token = auth.token!;
  const user = auth.user!;
  const data = useEmployeeData(token, user.id);
  const { refreshMonth, reloadRequests, requests } = data;

  const [tab, setTab] = useState<EmpTab>(tabFromLocation);
  const [today, setToday] = useState(todayStr);
  const [recordsMonth, setRecordsMonth] = useState(() => todayStr().slice(0, 7));
  const [logMonth, setLogMonth] = useState(() => todayStr().slice(0, 7));
  const [requestsView, setRequestsView] = useState<RequestsView>('requests');

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{
    day: DailyAttendanceDetail;
    punch: PunchPeriod;
  } | null>(null);
  const [history, setHistory] = useState<{ attendanceId: string; workDate: string } | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'danger' } | null>(null);

  const pendingRequests = useMemo(() => indexPendingRequests(requests), [requests]);

  // URL とタブを同期する（タブ以外のパスで開かれたときはホームの URL に直す）
  useEffect(() => {
    const expected = `${basePath()}${TAB_PATHS[tab]}`;
    const current = window.location.pathname.replace(/\/$/, '');
    if (current !== expected.replace(/\/$/, '')) {
      window.history.replaceState({}, '', expected);
    }
    // 初回表示時のみ。以降は goTab が pushState する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => setTab(tabFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goTab = (next: EmpTab) => {
    if (next !== tab) {
      window.history.pushState({}, '', `${basePath()}${TAB_PATHS[next]}`);
    }
    setTab(next);
    window.scrollTo(0, 0);
  };

  // 画面に戻ってきたとき（別アプリからの復帰など）に今日の記録を取り直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = todayStr();
      setToday(now);
      void refreshMonth(now.slice(0, 7));
      void reloadRequests();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshMonth, reloadRequests]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedMonth = selectedDate ? data.getMonth(selectedDate.slice(0, 7)) : null;
  const selectedDay =
    selectedDate && selectedMonth?.data
      ? (selectedMonth.data.days.find((d) => d.work_date === selectedDate) ?? null)
      : null;

  const reloadAfterChange = useCallback(
    async (workDate: string) => {
      await Promise.all([refreshMonth(workDate.slice(0, 7)), reloadRequests()]);
    },
    [refreshMonth, reloadRequests],
  );

  const handleCancelRequest = async (request: AttendanceCorrectionRequest) => {
    if (!window.confirm('この修正申請を取り消しますか？')) return;
    setBusy(true);
    try {
      await cancelCorrectionRequest(token, request.id);
      await reloadRequests();
      setToast({ text: '申請を取り消しました', tone: 'ok' });
    } catch (err) {
      setToast({
        text: err instanceof Error ? err.message : '取り消しに失敗しました',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBreak = async (punch: PunchPeriod) => {
    if (!punch.attendance_id || !selectedDate) return;
    const hasBreak = !!punch.break_minutes && punch.break_minutes > 0;
    const action = hasBreak ? '休憩を取り消し' : '休憩60分を追加し';
    if (!window.confirm(`${action}ますか？`)) return;
    setBusy(true);
    try {
      await updateAttendanceBreak(
        token,
        punch.attendance_id,
        hasBreak ? 0 : 60,
        hasBreak ? 'ユーザー操作による休憩を取消' : 'ユーザー操作による休憩(60分)を追加',
      );
      await reloadAfterChange(selectedDate);
      setToast({ text: hasBreak ? '休憩を取り消しました' : '休憩60分を追加しました', tone: 'ok' });
    } catch (err) {
      setToast({
        text: err instanceof Error ? err.message : '休憩の更新に失敗しました',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const openDay = useCallback((day: DailyAttendanceDetail) => setSelectedDate(day.work_date), []);

  return (
    <div className="emp-app">
      <header className="emp-topbar">
        <span className="emp-topbar__brand">{siteName}</span>
        <button
          type="button"
          className="emp-topbar__bell"
          aria-label={unreadCount > 0 ? `お知らせ（未読 ${unreadCount}件）` : 'お知らせ'}
          onClick={() => setShowNotifications(true)}
        >
          <BellIcon size={22} />
          {unreadCount > 0 && (
            <span className="emp-topbar__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>
      </header>

      <main className="emp-main">
        {tab === 'home' && (
          <HomeTab
            data={data}
            today={today}
            userName={user.name}
            pendingRequests={pendingRequests}
            onSelectDay={openDay}
            onOpenRecords={() => {
              setRecordsMonth(today.slice(0, 7));
              goTab('records');
            }}
            onOpenRequests={() => {
              setRequestsView('requests');
              goTab('requests');
            }}
          />
        )}
        {tab === 'records' && (
          <RecordsTab
            data={data}
            today={today}
            yearMonth={recordsMonth}
            onChangeMonth={setRecordsMonth}
            pendingRequests={pendingRequests}
            onSelectDay={openDay}
            onOpenEditLog={() => {
              setLogMonth(recordsMonth);
              setRequestsView('editlog');
              goTab('requests');
            }}
          />
        )}
        {tab === 'requests' && (
          <RequestsTab
            token={token}
            userId={user.id}
            today={today}
            view={requestsView}
            onChangeView={setRequestsView}
            requests={requests}
            requestsLoaded={data.requestsLoaded}
            busy={busy}
            onCancelRequest={handleCancelRequest}
            logYearMonth={logMonth}
            onChangeLogMonth={setLogMonth}
          />
        )}
        {tab === 'help' && <HelpTab token={token} />}
        {tab === 'me' && (
          <div className="emp-page emp-profile">
            <MyProfilePage auth={auth} />
            <section className="emp-section">
              <button type="button" className="emp-btn emp-btn--outline emp-btn--block" onClick={auth.logout}>
                ログアウト
              </button>
            </section>
          </div>
        )}
      </main>

      <nav className="emp-tabbar" aria-label="メニュー">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`emp-tabbar__item ${tab === key ? 'is-active' : ''}`}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => goTab(key)}
          >
            <span className="emp-tabbar__icon">
              <Icon size={24} />
              {key === 'requests' && pendingRequests.size > 0 && (
                <span className="emp-tabbar__badge">{pendingRequests.size}</span>
              )}
            </span>
            <span className="emp-tabbar__label">{label}</span>
          </button>
        ))}
      </nav>

      {selectedDay && (
        <DaySheet
          day={selectedDay}
          isLocked={selectedMonth?.data?.is_locked ?? false}
          pendingRequests={pendingRequests}
          busy={busy}
          onClose={() => setSelectedDate(null)}
          onRequestCorrection={(day, punch) => setCorrection({ day, punch })}
          onCancelRequest={handleCancelRequest}
          onToggleBreak={handleToggleBreak}
          onShowHistory={(attendanceId, workDate) => setHistory({ attendanceId, workDate })}
        />
      )}

      {correction && (
        <CorrectionSheet
          token={token}
          day={correction.day}
          punch={correction.punch}
          onClose={() => setCorrection(null)}
          onSubmitted={() => {
            const workDate = correction.day.work_date;
            setCorrection(null);
            setToast({ text: '修正申請を送信しました', tone: 'ok' });
            void reloadAfterChange(workDate);
          }}
        />
      )}

      {history && (
        <HistorySheet
          token={token}
          attendanceId={history.attendanceId}
          workDate={history.workDate}
          onClose={() => setHistory(null)}
        />
      )}

      {showNotifications && (
        <NotificationSheet
          notifications={notifications}
          unreadCount={unreadCount}
          onRead={onReadNotification}
          onReadAll={onReadAllNotifications}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {toast && (
        <div className={`emp-toast emp-toast--${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
