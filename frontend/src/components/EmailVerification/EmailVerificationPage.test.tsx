import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailVerificationPage } from './EmailVerificationPage';
import * as meApi from '../../api/me';

describe('EmailVerificationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ローディング中を表示する', () => {
    // resolve しない Promise でローディング状態を保持
    vi.spyOn(meApi, 'confirmEmailVerification').mockImplementation(
      () => new Promise(() => undefined),
    );

    render(<EmailVerificationPage token="valid-token" onGoLogin={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('確認中');
  });

  it('email_change 成功時に完了メッセージを表示する', async () => {
    vi.spyOn(meApi, 'confirmEmailVerification').mockResolvedValue({
      verification_type: 'email_change',
      email: 'confirmed@example.com',
      status: 'confirmed',
    });

    render(<EmailVerificationPage token="valid-token" onGoLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/メールアドレス変更が完了しました/)).toBeInTheDocument();
      expect(screen.getByText('confirmed@example.com')).toBeInTheDocument();
    });
  });

  it('signup 成功時に完了メッセージを表示する', async () => {
    vi.spyOn(meApi, 'confirmEmailVerification').mockResolvedValue({
      verification_type: 'signup',
      email: 'signup@example.com',
      status: 'confirmed',
    });

    render(<EmailVerificationPage token="valid-token" onGoLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/新規登録が完了しました/)).toBeInTheDocument();
    });
  });

  it('400 エラー時に「リンク無効」メッセージを表示する', async () => {
    const { ApiError } = await import('../../types/error');
    vi.spyOn(meApi, 'confirmEmailVerification').mockRejectedValue(
      new ApiError(400, { code: 'TOKEN_INVALID', message: 'invalid' }),
    );

    render(<EmailVerificationPage token="expired-token" onGoLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/無効、期限切れ/)).toBeInTheDocument();
    });
  });

  it('token が null の場合にエラーを表示する', async () => {
    render(<EmailVerificationPage token={null} onGoLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/確認トークンが見つかりません/)).toBeInTheDocument();
    });
  });

  it('ログイン画面へのボタンクリックで onGoLogin が呼ばれる', async () => {
    vi.spyOn(meApi, 'confirmEmailVerification').mockResolvedValue({
      verification_type: 'email_change',
      email: 'done@example.com',
      status: 'confirmed',
    });
    const onGoLogin = vi.fn();

    render(<EmailVerificationPage token="valid-token" onGoLogin={onGoLogin} />);

    await waitFor(() => screen.getByRole('button', { name: 'ログイン画面へ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ログイン画面へ' }));

    expect(onGoLogin).toHaveBeenCalledOnce();
  });
});
