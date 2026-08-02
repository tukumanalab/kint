import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentInfoModal } from './PaymentInfoModal';
import type { AttendanceMonthlySummary } from '../../types/attendance';

describe('PaymentInfoModal', () => {
  const mockSummaries: AttendanceMonthlySummary[] = [
    {
      user_id: 'user1',
      user_name: 'yamada',
      full_name: '山田 太郎',
      worker_id: '1234567',
      email: 'yamada@example.com',
      prescribed_days: 10,
      working_days: 5,
      total_working_hours: 15.2,
      total_requested_hours: 15.5,
      total_overtime_hours: 0,
      late_count: 0,
      early_leave_count: 0,
      absence_days: 0,
      incomplete_days: 0,
      alert_count: 0,
      unacknowledged_alert_count: 0,
      yearly_working_hours: 15.5,
    },
    {
      user_id: 'user2',
      user_name: 'sato',
      full_name: '佐藤 花子',
      worker_id: '2345678',
      email: 'sato@example.com',
      prescribed_days: 10,
      working_days: 8,
      total_working_hours: 24.0,
      total_requested_hours: 24.0,
      total_overtime_hours: 0,
      late_count: 0,
      early_leave_count: 0,
      absence_days: 0,
      incomplete_days: 0,
      alert_count: 0,
      unacknowledged_alert_count: 0,
      yearly_working_hours: 24.0,
    },
    {
      user_id: 'user3',
      user_name: 'suzuki',
      full_name: '鈴木 一郎',
      worker_id: '3456789',
      email: 'suzuki@example.com',
      prescribed_days: 10,
      working_days: 0, // 勤務なし
      total_working_hours: 0,
      total_requested_hours: 0,
      total_overtime_hours: 0,
      late_count: 0,
      early_leave_count: 0,
      absence_days: 0,
      incomplete_days: 0,
      alert_count: 0,
      unacknowledged_alert_count: 0,
      yearly_working_hours: 0,
    },
  ];

  beforeEach(() => {
    // HTMLDialogElement の polyfill / mock
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();

    // Clipboard API の mock
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('集計情報と支払先（カンマ区切り1行）が正しく計算・表示される', () => {
    const handleClose = vi.fn();
    render(
      <PaymentInfoModal
        summaries={mockSummaries}
        yearMonth="2026-08"
        onClose={handleClose}
      />
    );

    // ダイアログタイトル
    expect(screen.getByText(/支払い情報 \(2026年08月\)/)).toBeInTheDocument();

    // 集計: 勤務実績がある2名（山田・佐藤）の合計申請時間 (15.5 + 24.0 = 39.5時間)
    expect(screen.getByText('計2名 合計39.5時間')).toBeInTheDocument();

    // 支払先: カンマ区切り1行
    const textarea = screen.getByRole('textbox', { hidden: true }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('1234567 山田 太郎, 2345678 佐藤 花子');
  });

  it('コピーボタンをクリックするとクリップボードにコピーされる', async () => {
    const handleClose = vi.fn();
    render(
      <PaymentInfoModal
        summaries={mockSummaries}
        yearMonth="2026-08"
        onClose={handleClose}
      />
    );

    const copyButtons = screen.getAllByRole('button', { name: /コピー/, hidden: true });
    expect(copyButtons.length).toBe(2);

    // 集計のコピー
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('計2名 合計39.5時間');

    await waitFor(() => {
      expect(screen.getByText('✓ コピーしました')).toBeInTheDocument();
    });

    // 支払先のコピー
    fireEvent.click(copyButtons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('1234567 山田 太郎, 2345678 佐藤 花子');
  });

  it('閉じるボタンで onClose が呼ばれる', () => {
    const handleClose = vi.fn();
    render(
      <PaymentInfoModal
        summaries={mockSummaries}
        yearMonth="2026-08"
        onClose={handleClose}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: '閉じる', hidden: true });
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
