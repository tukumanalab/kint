import { useState, useEffect } from 'react';
import { confirmEmailVerification } from '../../api/me';
import { ApiError } from '../../types/error';
import type { EmailVerificationConfirmResponse } from '../../types/user';
import './EmailVerificationPage.css';

interface Props {
  token: string | null;
  onGoLogin: () => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'success'; result: EmailVerificationConfirmResponse }
  | { kind: 'error'; message: string };

const VERIFICATION_TYPE_LABELS: Record<string, string> = {
  signup: '新規登録',
  email_change: 'メールアドレス変更',
};

export function EmailVerificationPage({ token, onGoLogin }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: '確認トークンが見つかりません。リンクが正しいか確認してください。' });
      return;
    }

    confirmEmailVerification({ token })
      .then((result) => {
        setState({ kind: 'success', result });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) {
          setState({
            kind: 'error',
            message: '確認リンクが無効、期限切れ、または使用済みです。必要な場合は再度メール送信をお試しください。',
          });
        } else {
          setState({
            kind: 'error',
            message: '確認処理中にエラーが発生しました。しばらく時間をおいて再試行してください。',
          });
        }
      });
  }, [token]);

  return (
    <main className="email-verify-page">
      <div className="email-verify-card">
        <h1 className="email-verify-title">メール確認</h1>

        {state.kind === 'loading' && (
          <div className="email-verify-loading" role="status">
            確認中...
          </div>
        )}

        {state.kind === 'success' && (
          <div className="email-verify-success">
            <div className="email-verify-icon email-verify-icon--success" aria-hidden="true">
              ✓
            </div>
            <p className="email-verify-message">
              {VERIFICATION_TYPE_LABELS[state.result.verification_type] ?? state.result.verification_type}
              が完了しました。
            </p>
            <p className="email-verify-email">{state.result.email}</p>
            <button type="button" className="btn btn--primary" onClick={onGoLogin}>
              ログイン画面へ
            </button>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="email-verify-error">
            <div className="email-verify-icon email-verify-icon--error" aria-hidden="true">
              ✕
            </div>
            <p className="email-verify-message email-verify-message--error">{state.message}</p>
            <button type="button" className="btn btn--secondary" onClick={onGoLogin}>
              ログイン画面へ戻る
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
