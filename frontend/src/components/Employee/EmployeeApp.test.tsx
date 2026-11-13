import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as attendanceApi from '../../api/attendance';
import type { UseAuth } from '../../hooks/useAuth';
import type {
  AttendanceCorrectionRequest,
  AttendanceMonthlyDetailResponse,
  DailyAttendanceDetail,
} from '../../types/attendance';
import { EmployeeApp } from './EmployeeApp';

vi.mock('../../api/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/attendance')>();
  return {
    ...actual,
    getMonthlyAttendanceDetail: vi.fn(),
    listCorrectionRequests: vi.fn(),
    createCorrectionRequest: vi.fn(),
    cancelCorrectionRequest: vi.fn(),
    getAttendanceHistory: vi.fn(),
    getMonthlyAttendanceHistory: vi.fn(),
    updateAttendanceBreak: vi.fn(),
  };
});

vi.mock('../../api/docs', () => ({
  fetchEmployeeGuide: vi.fn().mockResolvedValue({
    title: '従業員向け 使い方ガイド',
    content:
      '# 従業員向け 使い方ガイド\n\n導入文です。\n\n---\n\n## 今日の記録を確認する\n\nホームを開きます。\n\n## 打刻を修正したいとき\n\n1. 日をタップします。\n2. 申請します。\n',
  }),
}));

// マイページは別のテストで確認しているため、ここでは API 呼び出しを避けて差し替える
vi.mock('../MyProfile', () => ({
  MyProfilePage: () => <div>マイページ本体</div>,
}));

/** 月末近く（2026-11-27 金曜 15:00）を「今日」とする。 */
const TODAY = new Date(2026, 10, 27, 15, 0);

/** ローカル時刻から、サーバーが返す形式（タイムゾーンなしの UTC）の文字列を作る。 */
function iso(day: number, hour: number, minute: number, month = 10): string {
  return new Date(2026, month, day, hour, minute).toISOString().replace('Z', '');
}

function makeMonth(yearMonth: string): AttendanceMonthlyDetailResponse {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const days: DailyAttendanceDetail[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(y, m - 1, d);
    const workDate = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const hasShift = [1, 2, 4, 5].includes(date.getDay());
    const isPast = date.getTime() < new Date(2026, 10, 27).getTime();
    const isToday = yearMonth === '2026-11' && d === 27;
    const worked = hasShift && (isPast || isToday);
    const incomplete = yearMonth === '2026-11' && d === 24;
    days.push({
      work_date: workDate,
      attendance_id: worked ? `att-${workDate}` : null,
      has_shift: hasShift,
      is_holiday: false,
      shift_start: hasShift ? iso(d, 13, 0, m - 1) : null,
      shift_end: hasShift ? iso(d, 18, 0, m - 1) : null,
      check_in: worked ? iso(d, 12, 55, m - 1) : null,
      check_out: worked && !isToday && !incomplete ? iso(d, 18, 5, m - 1) : null,
      calculated_check_in: worked ? iso(d, 13, 0, m - 1) : null,
      calculated_check_out: worked && !isToday && !incomplete ? iso(d, 18, 0, m - 1) : null,
      working_hours: worked && !isToday && !incomplete ? 5 : null,
      overtime_hours: null,
      status: isToday
        ? 'working'
        : incomplete
          ? 'incomplete'
          : worked
            ? 'normal'
            : hasShift
              ? 'scheduled'
              : 'off_duty',
      source: worked ? 'webusb_nfc' : null,
    });
  }
  return {
    user_id: 'emp1',
    year_month: yearMonth,
    is_locked: false,
    days,
    summary: {
      user_id: 'emp1',
      user_name: 'hanako',
      full_name: '田中 花子',
      email: 'hanako@example.com',
      prescribed_days: 17,
      working_days: 15,
      total_working_hours: 70,
      total_requested_hours: 70,
      total_overtime_hours: 0,
      late_count: 0,
      early_leave_count: 0,
      absence_days: 0,
      incomplete_days: 1,
      alert_count: 0,
      unacknowledged_alert_count: 0,
      yearly_working_hours: 300,
    },
  };
}

function makeAuth(): UseAuth {
  return {
    token: 'test-token',
    user: {
      id: 'emp1',
      role: 'employee',
      name: 'hanako',
      full_name: '田中 花子',
      email: 'hanako@example.com',
    },
    isLoading: false,
    error: null,
    pendingIdToken: null,
    loginWithGoogle: vi.fn(),
    register: vi.fn(),
    cancelRegister: vi.fn(),
    logout: vi.fn(),
  };
}

function renderApp(auth: UseAuth = makeAuth()) {
  return render(
    <EmployeeApp
      auth={auth}
      siteName="Kint"
      notifications={[]}
      unreadCount={0}
      onReadNotification={vi.fn()}
      onReadAllNotifications={vi.fn()}
    />,
  );
}

function tab(label: string): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'メニュー' })).getByRole('button', {
    name: new RegExp(label),
  });
}

describe('EmployeeApp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
    window.scrollTo = vi.fn();
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    vi.mocked(attendanceApi.getMonthlyAttendanceDetail).mockImplementation(
      async (_token, yearMonth) => makeMonth(yearMonth),
    );
    vi.mocked(attendanceApi.listCorrectionRequests).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(attendanceApi.getMonthlyAttendanceHistory).mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('ホームの先頭に今日の記録が表示される', async () => {
    renderApp();

    expect(await screen.findByText('勤務中です')).toBeInTheDocument();
    const todayCard = screen.getByText('勤務中です').closest('button')!;
    expect(within(todayCard).getByText('12:55')).toBeInTheDocument();
    expect(within(todayCard).getByText(/シフト 13:00〜18:00/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('11月27日(金)');
  });

  it('打刻もれの日がホームの「確認してください」に出る', async () => {
    renderApp();

    expect(await screen.findByText('確認してください')).toBeInTheDocument();
    expect(screen.getByText(/打刻もれがあります/)).toBeInTheDocument();
    expect(screen.getByText('11/24(火)')).toBeInTheDocument();
  });

  it('勤怠タブは月末でも今日の行が一覧の先頭に来る', async () => {
    const { container } = renderApp();
    await screen.findByText('勤務中です');

    fireEvent.click(tab('勤怠'));

    await waitFor(() => expect(container.querySelectorAll('.emp-day').length).toBeGreaterThan(0));
    const rows = container.querySelectorAll('.emp-day');
    expect(rows[0]).toHaveTextContent('今日');
    expect(rows[0]).toHaveTextContent('27');
    // シフトも打刻もない日は省略され、この先のシフトは折りたたまれている
    expect(container.querySelectorAll('.emp-day').length).toBeLessThan(27);
    expect(screen.getByRole('button', { name: /今後のシフト（1件）/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(window.location.pathname).toMatch(/records$/);
  });

  it('「古い順」に切り替えると1日から並ぶ', async () => {
    const { container } = renderApp();
    await screen.findByText('勤務中です');
    fireEvent.click(tab('勤怠'));
    await waitFor(() => expect(container.querySelectorAll('.emp-day').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /新しい順/ }));

    const first = container.querySelector('.emp-day')!;
    expect(first.querySelector('.emp-day__num')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /古い順/ })).toBeInTheDocument();
  });

  it('日をタップして修正申請を送信できる', async () => {
    vi.mocked(attendanceApi.createCorrectionRequest).mockResolvedValue(
      {} as AttendanceCorrectionRequest,
    );
    renderApp();

    fireEvent.click(await screen.findByText(/打刻もれがあります/));
    const daySheet = await screen.findByRole('dialog', { name: '11月24日(火)' });
    fireEvent.click(within(daySheet).getByRole('button', { name: '修正を申請する' }));

    const form = await screen.findByRole('dialog', { name: '打刻の修正申請' });
    // 理由が空のままでは送信されない
    fireEvent.click(within(form).getByRole('button', { name: '申請する' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('修正の理由を入力してください');
    expect(attendanceApi.createCorrectionRequest).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole('button', { name: /シフト終了 18:00/ }));
    fireEvent.change(within(form).getByLabelText(/修正の理由/), {
      target: { value: '退勤時にカードをかざし忘れました' },
    });
    fireEvent.click(within(form).getByRole('button', { name: '申請する' }));

    await waitFor(() => expect(attendanceApi.createCorrectionRequest).toHaveBeenCalledTimes(1));
    expect(attendanceApi.createCorrectionRequest).toHaveBeenCalledWith('test-token', {
      attendance_id: 'att-2026-11-24',
      requested_check_in: new Date(2026, 10, 24, 12, 55).toISOString(),
      requested_check_out: new Date(2026, 10, 24, 18, 0).toISOString(),
      reason: '退勤時にカードをかざし忘れました',
    });
    expect(await screen.findByText('修正申請を送信しました')).toBeInTheDocument();
  });

  it('承認待ちの申請がある記録には重ねて申請できない', async () => {
    vi.mocked(attendanceApi.listCorrectionRequests).mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'req-1',
          attendance_id: 'att-2026-11-24',
          user_id: 'emp1',
          requested_check_in: iso(24, 12, 55),
          requested_check_out: iso(24, 18, 0),
          reason: '退勤の打刻もれ',
          status: 'pending',
          approved_by_user_id: null,
          approval_comment: null,
          created_at: iso(25, 9, 0),
          updated_at: iso(25, 9, 0),
          user_name: 'hanako',
          user_full_name: '田中 花子',
          approved_by_name: null,
          work_date: '2026-11-24',
        },
      ],
    });
    renderApp();

    fireEvent.click(await screen.findByText(/修正申請中です（承認待ち）/));
    const daySheet = await screen.findByRole('dialog', { name: '11月24日(火)' });

    expect(within(daySheet).getByText('修正申請中（承認待ち）')).toBeInTheDocument();
    expect(within(daySheet).queryByRole('button', { name: '修正を申請する' })).not.toBeInTheDocument();
    expect(within(daySheet).getByRole('button', { name: '申請を取り消す' })).toBeInTheDocument();
  });

  it('ヘルプタブに従業員向けガイドが見出しごとに表示される', async () => {
    renderApp();
    await screen.findByText('勤務中です');

    fireEvent.click(tab('ヘルプ'));

    const heading = await screen.findByRole('button', { name: '打刻を修正したいとき' });
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(heading);
    expect(screen.getByText('日をタップします。')).toBeInTheDocument();
    // 区切り線の記号が文字のまま表示されない
    expect(screen.queryByText('---')).not.toBeInTheDocument();
  });

  it('マイページからログアウトできる', async () => {
    const auth = makeAuth();
    renderApp(auth);
    await screen.findByText('勤務中です');

    fireEvent.click(tab('マイページ'));
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));

    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
