import { useEffect, useState } from 'react';
import { postDeviceToken, verifyDeviceToken } from '../../api/punch_device';
import type { UseAuth } from '../../hooks/useAuth';
import { ApiError } from '../../types/error';

interface Props {
  auth: UseAuth;
}

export function PunchDeviceManager({ auth }: Props) {
  const { token } = auth;
  const [deviceName, setDeviceName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkDevice = async () => {
    const devToken = localStorage.getItem('kint_punch_device_token');
    if (!devToken) {
      setIsRegistered(false);
      setRegisteredName(null);
      setChecking(false);
      return;
    }
    try {
      const res = await verifyDeviceToken(devToken);
      setIsRegistered(res.valid);
      setRegisteredName(res.name);
    } catch {
      setIsRegistered(false);
      setRegisteredName(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkDevice();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) {
      setError('端末名を入力してください');
      return;
    }
    if (!token) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await postDeviceToken(token, deviceName.trim());
      localStorage.setItem('kint_punch_device_token', res.device_token);
      setIsRegistered(true);
      setRegisteredName(res.name);
      setDeviceName('');
      // アプリ全体で端末検証状態を再読み込みさせるためにカスタムイベントを発行する
      window.dispatchEvent(new Event('kint_device_changed'));
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? (err.body.message || '端末の登録に失敗しました') : '端末の登録に失敗しました';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnregister = () => {
    if (window.confirm('この端末の打刻登録を解除しますか？')) {
      localStorage.removeItem('kint_punch_device_token');
      setIsRegistered(false);
      setRegisteredName(null);
      window.dispatchEvent(new Event('kint_device_changed'));
    }
  };

  if (checking) {
    return (
      <section className="settings-section">
        <h2 className="settings-section__title">打刻端末管理</h2>
        <p className="settings-loading">端末ステータス確認中...</p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">打刻端末管理</h2>
      {isRegistered ? (
        <div className="device-status-box device-status-box--registered">
          <p className="device-status-text">
            この端末は打刻用端末として登録されています。
          </p>
          <dl className="device-meta-list" style={{ margin: '1rem 0' }}>
            <dt style={{ color: '#718096', fontSize: '0.875rem' }}>登録名</dt>
            <dd style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>{registeredName}</dd>
          </dl>
          <button
            type="button"
            className="settings-btn"
            onClick={handleUnregister}
            style={{
              marginTop: '1rem',
              backgroundColor: '#e53e3e',
              color: '#fff',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            登録を取り消す
          </button>
        </div>
      ) : (
        <form onSubmit={handleRegister} noValidate>
          <p className="device-status-text" style={{ marginBottom: '1rem', color: '#e53e3e' }}>
            この端末は打刻用端末として登録されていません。
          </p>
          <div className="settings-field" style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="deviceName" className="settings-field__label">
              端末名
            </label>
            <input
              id="deviceName"
              type="text"
              className="settings-field__input"
              placeholder="例: 1F受付iPad, 開発PC"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              disabled={submitting}
              style={{ width: '100%', maxWidth: '400px' }}
            />
            <p className="settings-field__hint">管理しやすい識別名を入力してください</p>
          </div>
          {error && <p className="settings-error" style={{ color: '#e53e3e', marginBottom: '1rem' }}>{error}</p>}
          <button
            type="submit"
            className="settings-btn settings-btn--primary"
            disabled={submitting}
          >
            {submitting ? '登録中...' : 'この端末を登録する'}
          </button>
        </form>
      )}
    </section>
  );
}
