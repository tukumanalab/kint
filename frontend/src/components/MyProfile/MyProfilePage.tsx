import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { fetchMyProfile, updateMyProfile, requestEmailChange } from '../../api/me';
import { ApiError } from '../../types/error';
import type { UserProfile } from '../../types/auth';
import type { UseAuth } from '../../hooks/useAuth';
import './MyProfilePage.css';

interface Props {
  auth: UseAuth;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  employee: '従業員',
};

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 3);
  return `${visible}****@${domain}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ===== プロフィール編集フォーム =====

interface ProfileEditFormProps {
  profile: UserProfile;
  token: string;
  onUpdated: (updated: UserProfile) => void;
  onSessionInvalidated: () => void;
}

function ProfileEditForm({ profile, token, onUpdated, onSessionInvalidated }: ProfileEditFormProps) {
  const [name, setName] = useState(profile.name);
  const [fullName, setFullName] = useState(profile.full_name);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // profile が更新されたら初期値を同期する
  useEffect(() => {
    setName(profile.name);
    setFullName(profile.full_name);
  }, [profile.name, profile.full_name]);

  const nameChanged = name.trim() !== profile.name;
  const fullNameChanged = fullName.trim() !== profile.full_name;
  const hasChanges = nameChanged || fullNameChanged;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('表示名を入力してください。');
      return;
    }
    if (!fullName.trim()) {
      setError('氏名を入力してください。');
      return;
    }
    if (!hasChanges) {
      setError('変更がありません。');
      return;
    }

    setSubmitting(true);
    try {
      const payload: { name?: string; full_name?: string } = {};
      if (nameChanged) payload.name = name.trim();
      if (fullNameChanged) payload.full_name = fullName.trim();
      const updated = await updateMyProfile(token, payload);
      onUpdated(updated);
      setSuccess('プロフィールを更新しました。');
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onSessionInvalidated();
          return;
        }
        if (err.status === 422) {
          setError('入力値に誤りがあります。各フィールドを確認してください。');
          return;
        }
      }
      setError('更新に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="myprofile-section">
      <h2 className="myprofile-section__title">プロフィール編集</h2>
      <form className="myprofile-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="profile-name" className="form-label">
            表示名 <span className="required">*</span>
          </label>
          <input
            id="profile-name"
            type="text"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            required
            disabled={submitting}
          />
          {name.length > 45 && (
            <p className="form-hint form-hint--warn">{50 - name.length} 文字まで入力できます</p>
          )}
        </div>
        <div className="form-field">
          <label htmlFor="profile-full-name" className="form-label">
            氏名 <span className="required">*</span>
          </label>
          <input
            id="profile-full-name"
            type="text"
            className="form-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={100}
            required
            disabled={submitting}
          />
          {fullName.length > 90 && (
            <p className="form-hint form-hint--warn">{100 - fullName.length} 文字まで入力できます</p>
          )}
        </div>
        {error && (
          <div className="form-alert form-alert--error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="form-alert form-alert--success" role="status">
            {success}
          </div>
        )}
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting || !hasChanges}
        >
          {submitting ? '更新中...' : '更新'}
        </button>
      </form>
    </section>
  );
}

// ===== メールアドレス変更フォーム =====

interface EmailChangeFormProps {
  token: string;
}

function EmailChangeForm({ token }: EmailChangeFormProps) {
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newEmail.trim()) {
      setError('新しいメールアドレスを入力してください。');
      return;
    }
    if (!isValidEmail(newEmail.trim())) {
      setError('正しいメールアドレスの形式で入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      await requestEmailChange(token, { new_email: newEmail.trim() });
      setSuccess(`${newEmail.trim()} 宛に確認メールを送信しました。メール内のリンクを開いて変更を完了してください。`);
      setNewEmail('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('このメールアドレスは既に使用されています。別のメールアドレスを入力してください。');
          return;
        }
        if (err.status === 422) {
          setError('正しいメールアドレスの形式で入力してください。');
          return;
        }
        if (err.status === 502) {
          setError('メール送信に失敗しました。しばらく時間をおいて再試行してください。');
          return;
        }
      }
      setError('操作に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="myprofile-section">
      <h2 className="myprofile-section__title">メールアドレス変更</h2>
      <form className="myprofile-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="new-email" className="form-label">
            新しいメールアドレス <span className="required">*</span>
          </label>
          <input
            id="new-email"
            type="email"
            className="form-input"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoComplete="email"
            disabled={submitting}
          />
        </div>
        {error && (
          <div className="form-alert form-alert--error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="form-alert form-alert--success" role="status">
            {success}
          </div>
        )}
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting || !newEmail.trim()}
        >
          {submitting ? '送信中...' : '確認メールを送信'}
        </button>
      </form>
    </section>
  );
}

// ===== マイページ本体 =====

export function MyProfilePage({ auth }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  const token = auth.token!;

  useEffect(() => {
    fetchMyProfile(token)
      .then((p) => {
        setProfile(p);
        setLoading(false);
      })
      .catch(() => {
        setLoadError('プロフィールの取得に失敗しました。');
        setLoading(false);
      });
  }, [token]);

  const handleSessionInvalidated = useCallback(() => {
    setSessionMessage('メールアドレスが変更されたため、セッションが無効化されました。再度ログインしてください。');
    setTimeout(() => {
      auth.logout();
    }, 2000);
  }, [auth]);

  if (loading) {
    return <div className="myprofile-loading">読み込み中...</div>;
  }

  if (loadError || !profile) {
    return (
      <main className="myprofile-page">
        <div className="form-alert form-alert--error" role="alert">
          {loadError ?? 'プロフィールを取得できませんでした。'}
        </div>
      </main>
    );
  }

  return (
    <main className="myprofile-page">
      <h1 className="myprofile-title">マイページ</h1>

      {sessionMessage && (
        <div className="form-alert form-alert--warn" role="alert">
          {sessionMessage}
        </div>
      )}

      {/* プロフィール情報（読み取り専用） */}
      <section className="myprofile-section myprofile-section--info">
        <h2 className="myprofile-section__title">プロフィール情報</h2>
        <dl className="myprofile-info-list">
          <dt className="myprofile-info-term">ロール</dt>
          <dd className="myprofile-info-desc">
            <span className={`role-badge role-badge--${profile.role}`}>
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>
          </dd>
          <dt className="myprofile-info-term">現在のメール</dt>
          <dd className="myprofile-info-desc myprofile-info-desc--masked">
            {maskEmail(profile.email)}
          </dd>
        </dl>
      </section>

      <ProfileEditForm
        profile={profile}
        token={token}
        onUpdated={setProfile}
        onSessionInvalidated={handleSessionInvalidated}
      />

      <EmailChangeForm token={token} />
    </main>
  );
}
