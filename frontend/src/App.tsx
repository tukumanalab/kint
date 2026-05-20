import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { PunchPage } from './components/Punch';
import { LoginPage } from './components/Login';
import { RegisterPage } from './components/Register';
import { UserManagementPage } from './components/Users';
import { MyProfilePage } from './components/MyProfile';
import { EmailVerificationPage } from './components/EmailVerification';
import { LogsPage } from './components/Logs';
import { SettingsPage } from './components/Settings';
import './App.css';

type Page = 'punch' | 'users' | 'myProfile' | 'settings' | 'logs';
type GuestPage = 'home' | 'punch' | 'login';

function getEmailVerificationToken(): string | null {
  if (window.location.pathname === '/email-verifications/confirm') {
    return new URLSearchParams(window.location.search).get('token');
  }
  return null;
}

function App() {
  const auth = useAuth();
  const [page, setPage] = useState<Page>('punch');
  const [guestPage, setGuestPage] = useState<GuestPage>('home');
  const [emailVerifToken] = useState<string | null>(getEmailVerificationToken);

  // メール確認ページはログイン不要・認証状態問わず表示
  if (window.location.pathname === '/email-verifications/confirm') {
    return (
      <EmailVerificationPage
        token={emailVerifToken}
        onGoLogin={() => {
          window.history.pushState({}, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  // 認証情報ロード中
  if (auth.isLoading) {
    return <div className="app-loading">読み込み中...</div>;
  }

  // 未ログイン → 打刻ページ（ログイン不要）・ログイン画面・トップページ
  if (!auth.token || !auth.user) {
    if (guestPage === 'punch') {
      return (
        <div className="app">
          <nav className="app-nav">
            <span className="app-nav__brand">Kint</span>
            <div className="app-nav__links">
              <button
                type="button"
                className="app-nav__link"
                onClick={() => setGuestPage('home')}
              >
                ← ホーム
              </button>
            </div>
            <div className="app-nav__user">
              <button
                type="button"
                className="app-nav__link"
                onClick={() => setGuestPage('login')}
              >
                ログイン
              </button>
            </div>
          </nav>
          <PunchPage />
        </div>
      );
    }

    if (guestPage === 'login') {
      if (auth.pendingIdToken) {
        return <RegisterPage auth={auth} />;
      }
      return <LoginPage auth={auth} />;
    }

    // トップページ
    return (
      <div className="top-page">
        <div className="top-page__content">
          <h1 className="top-page__title">Kint</h1>
          <p className="top-page__subtitle">NFC 勤怠管理システム</p>
          <div className="top-page__buttons">
            <button
              type="button"
              className="top-page__btn top-page__btn--primary"
              onClick={() => setGuestPage('punch')}
            >
              打刻
            </button>
            <button
              type="button"
              className="top-page__btn top-page__btn--secondary"
              onClick={() => setGuestPage('login')}
            >
              ログイン
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = auth.user.role === 'admin';

  return (
    <div className="app">
      <nav className="app-nav">
        <span className="app-nav__brand">Kint</span>
        <div className="app-nav__links">
          <button
            type="button"
            className={`app-nav__link ${page === 'punch' ? 'app-nav__link--active' : ''}`}
            onClick={() => setPage('punch')}
          >
            打刻
          </button>
          {isAdmin && (
            <button
              type="button"
              className={`app-nav__link ${page === 'users' ? 'app-nav__link--active' : ''}`}
              onClick={() => setPage('users')}
            >
              ユーザー管理
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={`app-nav__link ${page === 'settings' ? 'app-nav__link--active' : ''}`}
              onClick={() => setPage('settings')}
            >
              設定
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={`app-nav__link ${page === 'logs' ? 'app-nav__link--active' : ''}`}
              onClick={() => setPage('logs')}
            >
              ログ
            </button>
          )}
        </div>
        <div className="app-nav__user">
          <button
            type="button"
            className={`app-nav__link ${page === 'myProfile' ? 'app-nav__link--active' : ''}`}
            onClick={() => setPage('myProfile')}
          >
            {auth.user.name}
          </button>
          <button type="button" className="app-nav__logout" onClick={auth.logout}>
            ログアウト
          </button>
        </div>
      </nav>

      {page === 'punch' && <PunchPage />}
      {page === 'users' && isAdmin && <UserManagementPage auth={auth} />}
      {page === 'myProfile' && <MyProfilePage auth={auth} />}
      {page === 'settings' && isAdmin && <SettingsPage auth={auth} />}
      {page === 'logs' && isAdmin && <LogsPage auth={auth} />}
    </div>
  );
}

export default App;

