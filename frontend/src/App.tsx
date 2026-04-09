import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { PunchPage } from './components/Punch';
import { LoginPage } from './components/Login';
import { UserManagementPage } from './components/Users';
import './App.css';

type Page = 'punch' | 'users';

function App() {
  const auth = useAuth();
  const [page, setPage] = useState<Page>('punch');

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
          <span className="app-nav__user-name">{auth.user.name}</span>
          <button type="button" className="app-nav__logout" onClick={auth.logout}>
            ログアウト
          </button>
        </div>
      </nav>

      {page === 'punch' && <PunchPage />}
      {page === 'users' && isAdmin && <UserManagementPage auth={auth} />}
    </div>
  );
}

export default App;

