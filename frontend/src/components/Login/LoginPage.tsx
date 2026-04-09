import { useState } from 'react';
import type { FormEvent } from 'react';
import type { UseAuth } from '../../hooks/useAuth';
import './LoginPage.css';

interface Props {
  auth: UseAuth;
}

export function LoginPage({ auth }: Props) {
  const [accountId, setAccountId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accountId.trim() || !password) return;
    setSubmitting(true);
    try {
      await auth.login(accountId.trim(), password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1 className="login-title">Kint 管理画面</h1>
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="account-id" className="login-label">
              アカウントID
            </label>
            <input
              id="account-id"
              type="text"
              className="login-input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              autoComplete="username"
              disabled={submitting}
            />
          </div>
          <div className="login-field">
            <label htmlFor="password" className="login-label">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>
          {auth.error && (
            <div className="login-error" role="alert">
              {auth.error}
            </div>
          )}
          <button
            type="submit"
            className="btn btn--primary login-submit"
            disabled={submitting || !accountId.trim() || !password}
          >
            {submitting ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </main>
  );
}
