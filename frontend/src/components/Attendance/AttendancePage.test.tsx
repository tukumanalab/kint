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
    prescribed_days: 20,
    working_days: 18,
    total_working_hours: 144,
    total_overtime_hours: 10,
    late_count: 1,
    early_leave_count: 0,
    absence_days: 2,
    incomplete_days: 0,
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
});
