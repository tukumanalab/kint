import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendancePage } from './AttendancePage';
import * as attendanceApi from '../../api/attendance';
import type { UseAuth } from '../../hooks/useAuth';

vi.mock('../../api/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/attendance')>();
  return {
    ...actual,
    getAttendanceSummary: vi.fn(),
    getMonthlyAttendanceDetail: vi.fn(),
    listCorrectionRequests: vi.fn(),
    getAttendanceHistory: vi.fn(),
  };
});

const mockAdminUser = {
  id: 'admin-user',
  name: 'admin',
  full_name: '管理者太郎',
  email: 'admin@example.com',
  role: 'admin' as const,
};

const mockEmployeeUser = {
  id: 'employee-user',
  name: 'employee',
  full_name: '従業員花子',
  email: 'employee@example.com',
  role: 'employee' as const,
};

function makeAuth(user: typeof mockAdminUser | typeof mockEmployeeUser): UseAuth {
  return {
    token: 'test-token',
    user,
    isLoading: false,
    error: null,
    pendingIdToken: null,
    loginWithGoogle: vi.fn(),
    register: vi.fn(),
    cancelRegister: vi.fn(),
    logout: vi.fn(),
  };
}

const mockSummaries = [
  {
    user_id: 'employee-user',
    user_name: 'employee',
    full_name: '従業員花子',
    email: 'employee@example.com',
    prescribed_days: 20,
    working_days: 18,
    total_working_hours: 144,
    total_overtime_hours: 10,
    late_count: 1,
    early_leave_count: 0,
    absence_days: 2,
    incomplete_days: 0,
    yearly_working_hours: 144,
  },
];

const mockDetail = {
  user_id: 'employee-user',
  year_month: '2026-06',
  summary: mockSummaries[0],
  days: [
    {
      work_date: '2026-06-09',
      attendance_id: 'att-123',
      has_shift: true,
      is_holiday: false,
      shift_start: '2026-06-09T09:00:00Z',
      shift_end: '2026-06-09T18:00:00Z',
      check_in: '2026-06-09T09:00:00Z',
      check_out: '2026-06-09T18:00:00Z',
      calculated_check_in: '2026-06-09T09:00:00Z',
      calculated_check_out: '2026-06-09T18:00:00Z',
      working_hours: 8,
      overtime_hours: 0,
      status: 'normal' as const,
      source: 'webusb_nfc',
      is_auto_completed: false,
      punches: [],
    },
  ],
  is_locked: false,
};

const mockHistory = {
  items: [
    {
      id: 'history-1',
      attendance_id: 'att-123',
      actor_user_id: 'admin-user',
      actor_role: 'admin' as const,
      changed_at: '2026-06-09T10:00:00Z',
      before: {
        check_in: '2026-06-09T08:50:00Z',
        check_out: '2026-06-09T17:50:00Z',
      },
      after: {
        check_in: '2026-06-09T09:00:00Z',
        check_out: '2026-06-09T18:00:00Z',
      },
      reason: '手動修正テスト',
    },
  ],
  total: 1,
};

describe('AttendancePage - History', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue(mockSummaries);
    vi.mocked(attendanceApi.listCorrectionRequests).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(attendanceApi.getMonthlyAttendanceDetail).mockResolvedValue(mockDetail);
    vi.mocked(attendanceApi.getAttendanceHistory).mockResolvedValue(mockHistory);
  });

  it('管理者でログインし、詳細カレンダーで履歴ボタンをクリックすると履歴が表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockAdminUser)} />);

    // ロード待ち
    await waitFor(() => {
      expect(screen.getByText('月次勤務サマリー')).toBeInTheDocument();
    });

    // 「詳細カレンダー」をクリックして詳細を表示する
    const viewDetailBtn = screen.getByRole('button', { name: '詳細カレンダー' });
    fireEvent.click(viewDetailBtn);

    // 詳細カレンダーロード待ち
    await waitFor(() => {
      expect(screen.getByText(/日別勤怠詳細/)).toBeInTheDocument();
    });

    // 「履歴」ボタンが表示されていることを検証
    const historyBtn = screen.getByRole('button', { name: '履歴' });
    expect(historyBtn).toBeInTheDocument();

    // 履歴ボタンをクリック
    fireEvent.click(historyBtn);

    // モーダルが開き、履歴データが表示されることを検証
    await waitFor(() => {
      expect(screen.getByText('変更履歴 (2026-06-09)')).toBeInTheDocument();
      expect(screen.getByText('管理者 (ID: admin-user)')).toBeInTheDocument();
      expect(screen.getByText('手動修正テスト')).toBeInTheDocument();
    });

    // 閉じるボタンのクリックテスト
    const closeBtn = screen.getByRole('button', { name: '閉じる' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('変更履歴 (2026-06-09)')).not.toBeInTheDocument();
    });
  });

  it('一般従業員でログインした場合も、自身の履歴ボタンが表示され、クリックすると履歴が表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockEmployeeUser)} />);

    // 従業員ログイン時は自動的に詳細が表示される
    await waitFor(() => {
      expect(screen.getByText(/日別勤怠詳細/)).toBeInTheDocument();
    });

    // 「履歴」ボタンが表示されていることを検証
    const historyBtn = screen.getByRole('button', { name: '履歴' });
    expect(historyBtn).toBeInTheDocument();

    // 履歴ボタンをクリック
    fireEvent.click(historyBtn);

    // モーダルが開き、履歴データが表示されることを検証
    await waitFor(() => {
      expect(screen.getByText('変更履歴 (2026-06-09)')).toBeInTheDocument();
      expect(screen.getByText('管理者 (ID: admin-user)')).toBeInTheDocument();
      expect(screen.getByText('手動修正テスト')).toBeInTheDocument();
    });
  });

  it('詳細カレンダーに1週間毎の週次集計行（勤務日数・勤務時間）が表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockEmployeeUser)} />);

    // 従業員ログイン時は自動的に詳細が表示される
    await waitFor(() => {
      expect(screen.getByText(/日別勤怠詳細/)).toBeInTheDocument();
    });

    // 週次集計が表示されていることを検証
    expect(screen.getByText('週次集計:')).toBeInTheDocument();
    expect(screen.getByText('勤務: 1日')).toBeInTheDocument();
    expect(screen.getAllByText('8.00h')).toHaveLength(2);
  });
});

describe('AttendancePage - Search', () => {
  const mockMultipleSummaries = [
    {
      user_id: 'user-1',
      user_name: 'yamada',
      full_name: '山田太郎',
      email: 'yamada@example.com',
      prescribed_days: 20,
      working_days: 18,
      total_working_hours: 144,
      total_overtime_hours: 10,
      late_count: 1,
      early_leave_count: 0,
      absence_days: 2,
      incomplete_days: 0,
      yearly_working_hours: 144,
    },
    {
      user_id: 'user-2',
      user_name: 'sato',
      full_name: '佐藤花子',
      email: 'sato@example.com',
      prescribed_days: 20,
      working_days: 15,
      total_working_hours: 120,
      total_overtime_hours: 5,
      late_count: 0,
      early_leave_count: 1,
      absence_days: 5,
      incomplete_days: 0,
      yearly_working_hours: 120,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue(mockMultipleSummaries);
    vi.mocked(attendanceApi.listCorrectionRequests).mockResolvedValue({ items: [], total: 0 });
  });

  it('管理者画面で検索ワードを入力すると、合致する従業員のみが表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockAdminUser)} />);

    // 初期状態では両方表示されていること
    await waitFor(() => {
      expect(screen.getByText('yamada')).toBeInTheDocument();
      expect(screen.getByText('sato')).toBeInTheDocument();
    });

    // 検索入力
    const searchInput = screen.getByPlaceholderText('従業員名・氏名で検索...');
    fireEvent.change(searchInput, { target: { value: '山田' } });

    // 山田太郎だけが表示され、佐藤花子は非表示になること
    expect(screen.getByText('yamada')).toBeInTheDocument();
    expect(screen.queryByText('sato')).not.toBeInTheDocument();

    // 検索ワードをクリア
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('yamada')).toBeInTheDocument();
    expect(screen.getByText('sato')).toBeInTheDocument();
  });

  it('合致する従業員がいない場合、該当なしメッセージが表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockAdminUser)} />);

    await waitFor(() => {
      expect(screen.getByText('yamada')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('従業員名・氏名で検索...');
    fireEvent.change(searchInput, { target: { value: 'tanaka' } });

    expect(screen.queryByText('yamada')).not.toBeInTheDocument();
    expect(screen.queryByText('sato')).not.toBeInTheDocument();
    expect(screen.getByText('該当する従業員が見つかりません。')).toBeInTheDocument();
  });

  it('クリアボタンをクリックすると検索窓が空になり、全員が表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockAdminUser)} />);

    await waitFor(() => {
      expect(screen.getByText('yamada')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('従業員名・氏名で検索...');
    fireEvent.change(searchInput, { target: { value: '山田' } });
    expect(screen.queryByText('sato')).not.toBeInTheDocument();

    // ✕ ボタン（クリアボタン）をクリック
    const clearBtn = screen.getByTitle('検索条件をクリア');
    fireEvent.click(clearBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('yamada')).toBeInTheDocument();
    expect(screen.getByText('sato')).toBeInTheDocument();
  });

  it('管理者画面でメールアドレスを入力すると、合致する従業員のみが表示されること', async () => {
    render(<AttendancePage auth={makeAuth(mockAdminUser)} />);

    await waitFor(() => {
      expect(screen.getByText('yamada')).toBeInTheDocument();
      expect(screen.getByText('sato')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('従業員名・氏名で検索...');
    fireEvent.change(searchInput, { target: { value: 'sato@example.com' } });

    expect(screen.getByText('sato')).toBeInTheDocument();
    expect(screen.queryByText('yamada')).not.toBeInTheDocument();
  });
});


