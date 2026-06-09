import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyProfilePage } from './MyProfilePage';
import * as meApi from '../../api/me';
import type { UseAuth } from '../../hooks/useAuth';
import type { UserProfile } from '../../types/auth';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';

vi.mock('../../hooks/useWebUSBFeliCa', () => ({ useWebUSBFeliCa: vi.fn() }));
vi.mock('../../utils/browser', () => ({ isWebUSBSupported: vi.fn(() => true) }));

// jsdom は HTMLDialogElement.showModal を実装していないためモックする
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

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
    pendingIdToken: null,
    loginWithGoogle: vi.fn(),
    register: vi.fn(),
    cancelRegister: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

async function openProfileDialog() {
  const editBtn = screen.getByRole('button', { name: '編集' });
  fireEvent.click(editBtn);
}

describe('MyProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(HTMLDialogElement.prototype.showModal).mockReset();
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([]);
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

  it('プロフィール情報を表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([]);

    render(<MyProfilePage auth={makeAuth()} />);

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('従業員')).toBeInTheDocument();
      expect(screen.getByText(/tar\*\*\*\*@example\.com/)).toBeInTheDocument();
    });
  });

  it('プロフィールに表示名・氏名が表示される', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => {
      expect(screen.getByText('taro')).toBeInTheDocument();
      expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    });
  });

  it('プロフィール取得失敗時にエラーを表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockRejectedValue(new Error('network error'));

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('編集ボタンでダイアログが開く', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: '編集' }));
    await openProfileDialog();

    expect(screen.getByLabelText<HTMLInputElement>(/表示名/).value).toBe('taro');
    expect(screen.getByLabelText<HTMLInputElement>(/氏名/).value).toBe('山田 太郎');
  });

  it('変更なしで更新ボタンがdisableになる', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: '編集' }));
    await openProfileDialog();

    const submitBtn = screen.getByRole('button', { name: '更新' });
    expect(submitBtn).toBeDisabled();
  });

  it('表示名を変更して更新できる', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    vi.spyOn(meApi, 'updateMyProfile').mockResolvedValue({ ...mockProfile, name: 'taro2' });

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: '編集' }));
    await openProfileDialog();

    fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'taro2' } });

    const submitBtn = screen.getByRole('button', { name: '更新' });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('プロフィールを更新しました');
    });
  });

  it('updateMyProfile 失敗時にエラーメッセージを表示する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    const { ApiError } = await import('../../types/error');
    vi.spyOn(meApi, 'updateMyProfile').mockRejectedValue(
      new ApiError(409, { code: 'EMAIL_CONFLICT', message: 'conflict' }),
    );

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: '編集' }));
    await openProfileDialog();

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

  it('「カードを登録」ボタンでNFCダイアログが開く', async () => {
    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: 'カードを登録' }));
    fireEvent.click(screen.getByRole('button', { name: 'カードを登録' }));

    expect(screen.getByText('NFCカード登録')).toBeInTheDocument();
  });

  it('登録済みカードのIDmが一覧表示される', async () => {
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([
      { card_id: 'c1', card_idm: '0123456789ABCDEF', name: null, is_active: true, created_at: '2026-01-15T00:00:00Z' },
    ]);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => {
      expect(screen.getByText('0123456789ABCDEF')).toBeInTheDocument();
      expect(screen.getByText('有効')).toBeInTheDocument();
    });
  });

  it('削除ボタンで確認後カードが一覧から消える', async () => {
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([
      { card_id: 'c1', card_idm: '0123456789ABCDEF', name: null, is_active: true, created_at: '2026-01-15T00:00:00Z' },
    ]);
    vi.spyOn(meApi, 'deleteMyCard').mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: /カード 0123456789ABCDEF を削除/ }));
    fireEvent.click(screen.getByRole('button', { name: /カード 0123456789ABCDEF を削除/ }));

    await waitFor(() => {
      expect(screen.queryByText('0123456789ABCDEF')).not.toBeInTheDocument();
    });
  });

  it('削除確認をキャンセルするとカードが残る', async () => {
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([
      { card_id: 'c1', card_idm: '0123456789ABCDEF', name: null, is_active: true, created_at: '2026-01-15T00:00:00Z' },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: /カード 0123456789ABCDEF を削除/ }));
    fireEvent.click(screen.getByRole('button', { name: /カード 0123456789ABCDEF を削除/ }));

    expect(screen.getByText('0123456789ABCDEF')).toBeInTheDocument();
  });

  it('名前変更ボタンで入力欄が現れ保存できる', async () => {
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([
      { card_id: 'c1', card_idm: '0123456789ABCDEF', name: null, is_active: true, created_at: '2026-01-15T00:00:00Z' },
    ]);
    vi.spyOn(meApi, 'renameMyCard').mockResolvedValue({
      card_id: 'c1', card_idm: '0123456789ABCDEF', name: '通勤定期', is_active: true, created_at: '2026-01-15T00:00:00Z',
    });

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: /名前を変更/ }));
    fireEvent.click(screen.getByRole('button', { name: /名前を変更/ }));

    const input = screen.getByPlaceholderText('カード名（空欄で削除）');
    fireEvent.change(input, { target: { value: '通勤定期' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('通勤定期')).toBeInTheDocument();
    });
  });

  it('読み取ったカードがすでに登録済みの場合に登録済みメッセージが表示される', async () => {
    vi.spyOn(meApi, 'fetchMyCards').mockResolvedValue([
      { card_id: 'c1', card_idm: '0123456789ABCDEF', name: '通勤定期', is_active: true, created_at: '2026-01-15T00:00:00Z' },
    ]);
    vi.mocked(useWebUSBFeliCa).mockReturnValue({
      status: 'success',
      idm: '0123456789ABCDEF',
      errorMessage: null,
      connect: vi.fn(),
      readIdm: vi.fn(),
      disconnect: vi.fn(),
      reset: vi.fn(),
    });

    render(<MyProfilePage auth={makeAuth()} />);

    await waitFor(() => screen.getByRole('button', { name: 'カードを登録' }));
    fireEvent.click(screen.getByRole('button', { name: 'カードを登録' }));

    expect(screen.getByText(/「通勤定期」としてすでに登録されています/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'このカードを登録' })).not.toBeInTheDocument();
  });

  it('パスワード変更フォームでバリデーションが動作し、変更が成功する', async () => {
    vi.spyOn(meApi, 'fetchMyProfile').mockResolvedValue(mockProfile);
    const mockChangePassword = vi.spyOn(meApi, 'changePassword').mockResolvedValue(undefined);
    const authMock = makeAuth();

    render(<MyProfilePage auth={authMock} />);

    // ロード完了を待つ (Real Timers)
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());

    // ロード完了後に Fake Timers に切り替える
    vi.useFakeTimers();

    const currentInput = screen.getByLabelText(/^現在のパスワード\s*\*/) as HTMLInputElement;
    const newInput = screen.getByLabelText(/^新パスワード\s*\*/) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(/^新パスワード（確認）\s*\*/) as HTMLInputElement;
    const submitBtn = screen.getByRole('button', { name: 'パスワードを変更' });

    // 初期状態は disabled
    expect(submitBtn).toBeDisabled();

    // コピペ抑止テスト
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    currentInput.dispatchEvent(pasteEvent);
    expect(pasteEvent.defaultPrevented).toBe(true);

    // 強度不足のパスワード（英字のみ）
    fireEvent.change(currentInput, { target: { value: 'OldPass1' } });
    fireEvent.change(newInput, { target: { value: 'letters' } });
    fireEvent.change(confirmInput, { target: { value: 'letters' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/パスワードは8〜72文字で、英字と数字を各1文字以上含む必要があります/)).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // 不一致のパスワード
    fireEvent.change(newInput, { target: { value: 'NewPass2' } });
    fireEvent.change(confirmInput, { target: { value: 'DiffPass2' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/パスワードが一致しません/)).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // 正常値入力
    fireEvent.change(confirmInput, { target: { value: 'NewPass2' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    // 非同期の API 呼び出しと1つ目のタイムアウト (2秒) を進める
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockChangePassword).toHaveBeenCalledWith('test-token', {
      current_password: 'OldPass1',
      new_password: 'NewPass2',
    });
    expect(screen.getByRole('status')).toHaveTextContent('パスワードを変更しました');

    // 2つ目のタイムアウト（ログアウト実行までさらに2秒）を進める
    await vi.advanceTimersByTimeAsync(2000);
    expect(authMock.logout).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
