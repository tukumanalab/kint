import { useState } from 'react';
import type { FormEvent } from 'react';
import type { UseAuth } from '../../hooks/useAuth';
import './RegisterPage.css';

function decodeGoogleIdToken(token: string): { email: string; name: string } {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    const payload = JSON.parse(decoder.decode(bytes)) as { email?: string; name?: string };
    return { email: payload.email ?? '', name: payload.name ?? '' };
  } catch {
    return { email: '', name: '' };
  }
}

interface Props {
  auth: UseAuth;
}

export function RegisterPage({ auth }: Props) {
  const [adminPassword, setAdminPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const profile = auth.pendingIdToken
    ? decodeGoogleIdToken(auth.pendingIdToken)
    : { email: '', name: '' };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await auth.register(adminPassword || undefined);
    } catch {
      // エラーは useAuth 側で管理する
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="register-page">
      <div className="register-card">
        <h1 className="register-title">アカウント登録</h1>
        <p className="register-desc">以下の Google アカウントで新規登録します。</p>
        <div className="register-info">
          <div className="register-info-row">
            <span className="register-info-label">名前</span>
            <span className="register-info-value">{profile.name}</span>
          </div>
          <div className="register-info-row">
            <span className="register-info-label">メール</span>
            <span className="register-info-value">{profile.email}</span>
          </div>
        </div>
        {auth.error && <p className="register-error">{auth.error}</p>}
        <form className="register-form" onSubmit={handleSubmit} noValidate>
          <div className="register-field">
            <label htmlFor="admin-password" className="register-label">
              管理者パスワード（任意）
            </label>
            <input
              id="admin-password"
              type="password"
              className="register-input"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="管理者として登録する場合のみ入力"
              autoComplete="off"
              disabled={submitting || auth.isLoading}
            />
            <p className="register-hint">入力しない場合は従業員として登録されます。</p>
          </div>
          <button
            type="submit"
            className="register-submit"
            disabled={submitting || auth.isLoading}
          >
            {submitting || auth.isLoading ? '登録中...' : '登録する'}
          </button>
        </form>
        <button
          type="button"
          className="register-cancel"
          onClick={auth.cancelRegister}
          disabled={submitting || auth.isLoading}
        >
          戻る
        </button>
      </div>
    </main>
  );
}
