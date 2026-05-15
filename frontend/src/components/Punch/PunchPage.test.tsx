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
      attendance_id: 'att-1',
      user_id: 'user-001',
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
});