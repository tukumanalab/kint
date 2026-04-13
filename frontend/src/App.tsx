import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { PunchPage } from './components/Punch';
import { LoginPage } from './components/Login';
import { UserManagementPage } from './components/Users';
import { MyProfilePage } from './components/MyProfile';
import { EmailVerificationPage } from './components/EmailVerification';
import './App.css';

type Page = 'punch' | 'users' | 'myProfile';

function getEmailVerificationToken(): string | null {
  if (window.location.pathname === '/email-verifications/confirm') {
    return new URLSearchParams(window.location.search).get('token');
  }
  return null;
}

function App() {
  const auth = useAuth();
  const [page, setPage] = useState<Page>('punch');
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

  // 未ログイン → ログイン画面
  if (!auth.token || !auth.user) {
    return <LoginPage auth={auth} />;
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
    </div>
  );
}

export default App;

