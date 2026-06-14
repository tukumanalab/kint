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
import { fetchMyNotifications, readNotification, readAllNotifications } from './api/me';
import type { Notification } from './types/notification';
import { NotificationPopover } from './components/Notification/NotificationPopover';
import './App.css';

type Page = 'punch' | 'users' | 'myProfile' | 'settings' | 'logs' | 'attendance';
type GuestPage = 'home' | 'punch' | 'login';

function getEmailVerificationToken(): string | null {
  if (window.location.pathname === '/email-verifications/confirm') {
    return new URLSearchParams(window.location.search).get('token');
  }
  return null;
}

function isPunchPath(): boolean {
  const path = window.location.pathname.replace(/\/$/, '');
  return path === '/kint/punch' || path === '/punch';
}

function getInitialGuestPage(): GuestPage {
  if (isPunchPath()) {
    return 'punch';
  }
  return 'home';
}

function getInitialPage(): Page {
  if (isPunchPath()) {
    return 'punch';
  }
  return 'attendance';
}

function App() {
  const auth = useAuth();
  const [page, setPage] = useState<Page>(getInitialPage);
  const [guestPage, setGuestPage] = useState<GuestPage>(getInitialGuestPage);
  const [emailVerifToken] = useState<string | null>(getEmailVerificationToken);

  // お知らせ関連のステート
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isNotificationOpen, setIsNotificationOpen] = useState<boolean>(false);

  const loadNotifications = useCallback(async () => {
    if (!auth.token) return;
    try {
      const res = await fetchMyNotifications(auth.token);
      setNotifications(res.items);
      setUnreadCount(res.unread_count);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [auth.token]);

  // 定期ポーリング（60秒ごと）および初期読み込み
  useEffect(() => {
    if (auth.token && auth.user) {
      Promise.resolve().then(() => {
        loadNotifications();
      });
      const interval = setInterval(loadNotifications, 60000);
      return () => clearInterval(interval);
    } else {
      Promise.resolve().then(() => {
        setNotifications([]);
        setUnreadCount(0);
        setIsNotificationOpen(false);
      });
    }
  }, [auth.token, auth.user, loadNotifications]);

  const handleReadNotification = async (id: string) => {
    if (!auth.token) return;
    try {
      await readNotification(auth.token, id);
      await loadNotifications();
    } catch (err) {
      console.error('Failed to read notification:', err);
    }
  };

  const handleReadAllNotifications = async () => {
    if (!auth.token) return;
    try {
      await readAllNotifications(auth.token);
      await loadNotifications();
    } catch (err) {
      console.error('Failed to read all notifications:', err);
    }
  };


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

  const isAdmin = auth.user?.role === 'admin';

  // ステートと URL の同期
  useEffect(() => {
    if (!auth.token || !auth.user) {
      if (guestPage === 'punch') {
        if (!isPunchPath()) {
          window.history.pushState({}, '', '/kint/punch');
        }
      } else {
        const path = window.location.pathname.replace(/\/$/, '');
        if (path !== '/kint/' && path !== '/kint' && path !== '/') {
          window.history.pushState({}, '', '/kint/');
        }
      }
    } else {
      if (page === 'punch') {
        if (!isPunchPath()) {
          window.history.pushState({}, '', '/kint/punch');
        }
      } else {
        if (isPunchPath()) {
          window.history.pushState({}, '', '/kint/');
        }
      }
    }
  }, [guestPage, page, auth.token, auth.user]);

  // popstate イベントハンドラー
  useEffect(() => {
    const handlePopState = () => {
      const isPunch = isPunchPath();

      if (!auth.token || !auth.user) {
        if (isPunch) {
          setGuestPage('punch');
        } else {
          setGuestPage('home');
        }
      } else {
        if (isPunch) {
          setPage('punch');
        } else {
          setPage(prev => prev === 'punch' ? 'attendance' : prev);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [auth.token, auth.user]);

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
                管理者による端末の登録が必要です。
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
              onClick={() => setGuestPage('login')}
            >
              ログイン
            </button>
          </div>
          <button
            type="button"
            className="top-page__punch-link"
            onClick={() => setGuestPage('punch')}
          >
            打刻端末として使用する
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
          {/* 管理者向け打刻リンクはメニューバーから非表示 */}
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
          <div className="app-nav__notification-container">
            <button
              type="button"
              className={`app-nav__notification-btn ${isNotificationOpen ? 'app-nav__notification-btn--active' : ''}`}
              onClick={() => setIsNotificationOpen(prev => !prev)}
              title="お知らせ"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                style={{ width: '20px', height: '20px' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
              {unreadCount > 0 && (
                <span className="app-nav__notification-badge">{unreadCount}</span>
              )}
            </button>
            <NotificationPopover
              notifications={notifications}
              unreadCount={unreadCount}
              isOpen={isNotificationOpen}
              onClose={() => setIsNotificationOpen(false)}
              onRead={handleReadNotification}
              onReadAll={handleReadAllNotifications}
            />
          </div>
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

