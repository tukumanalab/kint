import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyProfilePage } from './MyProfilePage';
import * as meApi from '../../api/me';
import type { UseAuth } from '../../hooks/useAuth';
import type { UserProfile } from '../../types/auth';

const mockProfile: UserProfile = {
  id: 'taro',
  name: 'taro',
  full_name: '山田 太郎',
  email: 'taro@example.com',
  role: 'employee',
};

function makeAuth(overrides: Partial<UseAuth> = {}): UseAuth {
  return {
    token: 'test-token',
    user: mockProfile,
    isLoading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe('MyProfilePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('プロフィール情報を表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('従業員')).toBeInTheDocument();
      expect(screen.getByText(/tar\*\*\*\*@example\.com/)).toBeInTheDocument();
    });
  });

  it('プロフィール取得失敗時にエラーを表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockRejectedValue(new Error('network error'));

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('プロフィール編集フォームの初期値がプロフィール情報と一致する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/表示名/));

    expect(screen.getByLabelText<HTMLInputElement>(/表示名/).value).toBe('taro');
    expect(screen.getByLabelText<HTMLInputElement>(/氏名/).value).toBe('山田 太郎');
  });

  it('変更なしで更新ボタンがdisableになる', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/表示名/));

    const submitBtn = screen.getByRole('button', { name: '更新' });
    expect(submitBtn).toBeDisabled();
  });

  it('表示名を変更して更新できる', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'updateMyProfile').mockResolvedValue({ ...mockProfile, name: 'taro2' });

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/表示名/));

    fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'taro2' } });

    const submitBtn = screen.getByRole('button', { name: '更新' });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('プロフィールを更新しました');
    });
  });

  it('updateMyProfile 409 でエラーメッセージを表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    const { ApiError } = await import('../../types/error');
    vi.spyOn(meApi, 'updateMyProfile').mockRejectedValue(
      new ApiError(409, { code: 'EMAIL_CONFLICT', message: 'conflict' }),
    );

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/表示名/));

    fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'newname' } });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('メール変更確認メール送信が成功する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'requestEmailChange').mockResolvedValue({
      status: 'pending_confirmation',
      requested_email: 'newemail@example.com',
    });

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/新しいメールアドレス/));

    fireEvent.change(screen.getByLabelText(/新しいメールアドレス/), {
      target: { value: 'newemail@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認メールを送信' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('確認メールを送信しました');
    });
  });

  it('パスワード変更で現在パスワード不一致時に 401 エラーを表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    const { ApiError } = await import('../../types/error');
    vi.spyOn(meApi, 'changePassword').mockRejectedValue(
      new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'wrong password' }),
    );

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByLabelText(/現在のパスワード/));

    fireEvent.change(screen.getByLabelText(/現在のパスワード/), { target: { value: 'OldPass1' } });
    fireEvent.change(screen.getByLabelText(/新しいパスワード/, { selector: '#new-password' }), { target: { value: 'NewPass1' } });
    fireEvent.change(screen.getByLabelText(/新しいパスワード（確認）/), { target: { value: 'NewPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('現在のパスワードが正しくありません');
    });
  });

  it('パスワード変更成功後に logout が呼ばれる', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'changePassword').mockResolvedValue(undefined);

    const logoutMock = vi.fn();
    render(<MyProfilePage auth={makeAuth({ logout: logoutMock })} />);

    await waitFor(() => screen.getByLabelText(/現在のパスワード/));

    fireEvent.change(screen.getByLabelText(/現在のパスワード/), { target: { value: 'OldPass1' } });
    fireEvent.change(screen.getByLabelText(/新しいパスワード/, { selector: '#new-password' }), { target: { value: 'NewPass2' } });
    fireEvent.change(screen.getByLabelText(/新しいパスワード（確認）/), { target: { value: 'NewPass2' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }));

    await waitFor(
      () => {
        expect(logoutMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});
