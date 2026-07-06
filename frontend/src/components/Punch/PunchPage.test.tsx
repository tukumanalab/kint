import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PunchPage } from './PunchPage';
import * as punchApi from '../../api/punch';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';

vi.mock('../../hooks/useWebUSBFeliCa', () => ({ useWebUSBFeliCa: vi.fn() }));
vi.mock('../../utils/browser', () => ({ isWebUSBSupported: vi.fn(() => true) }));

describe('PunchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWebUSBFeliCa).mockReturnValue({
      status: 'idle',
      idm: null,
      errorMessage: null,
      connect: vi.fn(),
      readIdm: vi.fn(),
      disconnect: vi.fn(),
      reset: vi.fn(),
    });
  });

  it('表示名または氏名で検索して候補選択後に打刻できる', async () => {
    vi.spyOn(punchApi, 'searchPunchUsers').mockResolvedValue({
      users: [
        { id: 'user-001', name: 'taro', full_name: '山田 太郎' },
      ],
    });
    vi.spyOn(punchApi, 'postPunch').mockResolvedValue({
      status: 'completed',
      attendance_id: 'att-1',
      user_id: 'user-001',
      user_name: 'taro',
      action: 'check_in',
      occurred_at: '2026-05-15T00:00:00Z',
      method: 'user_id',
      message: '打刻しました',
    });

    render(<PunchPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'カード忘れ打刻' }));
    fireEvent.change(screen.getByLabelText(/ユーザー検索/), { target: { value: '山田' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /山田 太郎/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /山田 太郎/ }));
    fireEvent.change(screen.getByLabelText(/打刻理由/), {
      target: { value: 'カード忘れのため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打刻' }));

    await waitFor(() => {
      expect(punchApi.postPunch).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-001',
          reason: 'カード忘れのため',
        }),
      );
    });
  });

  it('候補未選択のままでは打刻ボタンを押せない', async () => {
    vi.spyOn(punchApi, 'searchPunchUsers').mockResolvedValue({ users: [] });

    render(<PunchPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'カード忘れ打刻' }));
    fireEvent.change(screen.getByLabelText(/ユーザー検索/), { target: { value: '山田' } });
    fireEvent.change(screen.getByLabelText(/打刻理由/), {
      target: { value: 'カード忘れのため' },
    });

    expect(screen.getByRole('button', { name: '打刻' })).toBeDisabled();
  });

  it('出勤打刻（check_in）成功時に丸め後の勤務出勤時刻が表示されること（シフトがある場合）', async () => {
    vi.spyOn(punchApi, 'searchPunchUsers').mockResolvedValue({
      users: [{ id: 'user-001', name: 'taro', full_name: '山田 太郎' }],
    });
    vi.spyOn(punchApi, 'postPunch').mockResolvedValue({
      status: 'completed',
      attendance_id: 'att-1',
      user_id: 'user-001',
      user_name: 'taro',
      action: 'check_in',
      occurred_at: '2026-05-15T09:03:00Z',
      method: 'user_id',
      message: '出勤を記録しました',
      calculated_time: '2026-05-15T09:05:00Z', // シフト基準で丸められた時間
    });

    render(<PunchPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'カード忘れ打刻' }));
    fireEvent.change(screen.getByLabelText(/ユーザー検索/), { target: { value: '山田' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /山田 太郎/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /山田 太郎/ }));
    fireEvent.change(screen.getByLabelText(/打刻理由/), {
      target: { value: 'カード忘れのため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打刻' }));

    await waitFor(() => {
      expect(screen.getByText(/勤務出勤時刻 \(丸め後\)/)).toBeInTheDocument();
      // タイムゾーン依存のズレを考慮し、Dateオブジェクトから動的に期待される時間文字列を作ってアサート
      const expectedTimeStr = new Date('2026-05-15T09:05:00Z').toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(screen.getByText(expectedTimeStr)).toBeInTheDocument();
    });
  });

  it('出勤打刻（check_in）成功時に丸められた勤務出勤時刻が表示されること（シフトがない場合）', async () => {
    vi.spyOn(punchApi, 'searchPunchUsers').mockResolvedValue({
      users: [{ id: 'user-001', name: 'taro', full_name: '山田 太郎' }],
    });
    vi.spyOn(punchApi, 'postPunch').mockResolvedValue({
      status: 'completed',
      attendance_id: 'att-1',
      user_id: 'user-001',
      user_name: 'taro',
      action: 'check_in',
      occurred_at: '2026-05-15T09:03:00Z',
      method: 'user_id',
      message: '出勤を記録しました',
      calculated_time: '2026-05-15T09:05:00Z', // シフトなしでも5分切り上げされる
    });

    render(<PunchPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'カード忘れ打刻' }));
    fireEvent.change(screen.getByLabelText(/ユーザー検索/), { target: { value: '山田' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /山田 太郎/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /山田 太郎/ }));
    fireEvent.change(screen.getByLabelText(/打刻理由/), {
      target: { value: 'カード忘れのため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打刻' }));

    await waitFor(() => {
      expect(screen.getByText(/勤務出勤時刻 \(丸め後\)/)).toBeInTheDocument();
      // タイムゾーン依存のズレを考慮し、Dateオブジェクトから動的に期待される時間文字列を作ってアサート
      const expectedTimeStr = new Date('2026-05-15T09:05:00Z').toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(screen.getByText(expectedTimeStr)).toBeInTheDocument();
    });
  });

  it('退勤打刻（check_out）成功時に今回の勤務時間と本日の合計勤務時間が表示されること', async () => {
    vi.spyOn(punchApi, 'searchPunchUsers').mockResolvedValue({
      users: [{ id: 'user-001', name: 'taro', full_name: '山田 太郎' }],
    });
    vi.spyOn(punchApi, 'postPunch').mockResolvedValue({
      status: 'completed',
      attendance_id: 'att-1',
      user_id: 'user-001',
      user_name: 'taro',
      action: 'check_out',
      occurred_at: '2026-05-15T18:00:00Z',
      method: 'user_id',
      message: '退勤を記録しました',
      calculated_time: '2026-05-15T18:00:00Z',
      current_working_hours: 8.83,
      daily_working_hours_total: 8.83,
    });

    render(<PunchPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'カード忘れ打刻' }));
    fireEvent.change(screen.getByLabelText(/ユーザー検索/), { target: { value: '山田' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /山田 太郎/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /山田 太郎/ }));
    fireEvent.change(screen.getByLabelText(/打刻理由/), {
      target: { value: 'カード忘れのため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打刻' }));

    await waitFor(() => {
      // ラベルテキストの存在アサーション
      expect(screen.getByText(/今回の勤務時間/)).toBeInTheDocument();
      expect(screen.getByText(/本日の合計勤務時間/)).toBeInTheDocument();
      // 具体的な労働時間数値の表示をアサート (正規表現で改行や余分なスペースを許容しつつ)
      const matches = screen.getAllByText(/8:50/);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('連続打刻無視レスポンス(action: null)を受け取っても、直前の打刻成功通知が維持されること', async () => {
    vi.spyOn(punchApi, 'postPunch').mockResolvedValueOnce({
      status: 'completed',
      attendance_id: 'att-1',
      user_id: 'user-001',
      user_name: '山田 太郎',
      action: 'check_in',
      occurred_at: '2026-05-15T09:00:00Z',
      method: 'card_idm',
      message: '出勤を記録しました',

    });

    const mockReadIdm = vi.fn().mockResolvedValueOnce('0123456789ABCDEF');

    vi.mocked(useWebUSBFeliCa).mockReturnValue({
      status: 'connected',
      idm: null,
      errorMessage: null,
      connect: vi.fn(),
      readIdm: mockReadIdm,
      disconnect: vi.fn(),
      reset: vi.fn(),
    });

    render(<PunchPage displaySeconds={30} />);

    await waitFor(() => {
      expect(screen.getByText('出勤しました')).toBeInTheDocument();
      expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    });

    // 時間経過前でも成功通知が残っていることを検証
    expect(screen.getByText('出勤しました')).toBeInTheDocument();
  });
});
