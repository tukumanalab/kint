import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { PunchPage } from './components/Punch';
import { verifyDeviceToken } from './api/punch_device';
import { LoginPage } from './components/Login';
import { RegisterPage } from './components/Register';
import { UserManagementPage } from './components/Users';
import { MyProfilePage } from './components/MyProfile';
import { EmailVerificationPage } from './components/EmailVerification';
import { LogsPage } from './components/Logs';
import { SettingsPage } from './components/Settings';
import { AttendancePage } from './components/Attendance';
import './App.css';

type Page = 'punch' | 'users' | 'myProfile' | 'settings' | 'logs' | 'attendance';
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

  // 打刻デバイストークンの検証状態
  const [deviceStatus, setDeviceStatus] = useState<{
    isChecked: boolean;
    isValid: boolean;
    deviceName: string | null;
  }>({
    isChecked: false,
    isValid: false,
    deviceName: null,
  });

  const checkDeviceToken = useCallback(async () => {
    const token = localStorage.getItem('kint_punch_device_token');
    if (!token) {
      await Promise.resolve();
      setDeviceStatus({ isChecked: true, isValid: false, deviceName: null });
      return;
    }
    try {
      const res = await verifyDeviceToken(token);
      setDeviceStatus({ isChecked: true, isValid: res.valid, deviceName: res.name });
    } catch {
      setDeviceStatus({ isChecked: true, isValid: false, deviceName: null });
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      checkDeviceToken();
    });
    window.addEventListener('kint_device_changed', checkDeviceToken);
    return () => {
      window.removeEventListener('kint_device_changed', checkDeviceToken);
    };
  }, [checkDeviceToken, auth.token]);

  // ログイン後のハンドリング: 一般ユーザーは打刻ページを表示させず勤怠一覧にする
  const isAdmin = auth.user?.role === 'admin';
  useEffect(() => {
    if (auth.user && !isAdmin && page === 'punch') {
      Promise.resolve().then(() => {
        setPage('attendance');
      });
    }
  }, [auth.user, isAdmin, page]);

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
    // pendingIdToken がある場合は、常に登録画面を最優先で表示する
    if (auth.pendingIdToken) {
      return <RegisterPage auth={auth} />;
    }

    if (guestPage === 'punch') {
      if (!deviceStatus.isChecked) {
        return <div className="app-loading">読み込み中...</div>;
      }

      if (!deviceStatus.isValid) {
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
            </nav>
            <div className="unregistered-device-container" style={{ padding: '3rem 1.5rem', textAlign: 'center', maxWidth: '600px', margin: '4rem auto', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', backgroundColor: '#fff' }}>
              <h2 style={{ marginBottom: '1rem', color: '#e53e3e' }}>未登録の端末です</h2>
              <p style={{ marginBottom: '0.5rem', fontSize: '1.05rem' }}>この端末は打刻用端末として登録されていません。</p>
              <p style={{ marginBottom: '2rem', color: '#718096', fontSize: '0.95rem' }}>
                管理者がログインし、設定画面からこの端末を登録する必要があります。
              </p>
              <button
                type="button"
                className="top-page__btn top-page__btn--primary"
                onClick={() => setGuestPage('login')}
              >
                管理者ログイン画面へ
              </button>
            </div>
          </div>
        );
      }

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
            <div className="app-nav__user" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: '#4a5568', fontWeight: 'bold', fontSize: '0.9rem' }}>
                端末: {deviceStatus.deviceName}
              </span>
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

  return (
    <div className="app">
      <nav className="app-nav">
        <span className="app-nav__brand">Kint</span>
        <div className="app-nav__links">
          {isAdmin && (
            <button
              type="button"
              className={`app-nav__link ${page === 'punch' ? 'app-nav__link--active' : ''}`}
              onClick={() => setPage('punch')}
            >
              打刻
            </button>
          )}
          <button
            type="button"
            className={`app-nav__link ${page === 'attendance' ? 'app-nav__link--active' : ''}`}
            onClick={() => setPage('attendance')}
          >
            勤怠一覧
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
      {page === 'attendance' && <AttendancePage auth={auth} />}
      {page === 'users' && isAdmin && <UserManagementPage auth={auth} />}
      {page === 'myProfile' && <MyProfilePage auth={auth} />}
      {page === 'settings' && isAdmin && <SettingsPage auth={auth} />}
      {page === 'logs' && isAdmin && <LogsPage auth={auth} />}
    </div>
  );
}

export default App;

