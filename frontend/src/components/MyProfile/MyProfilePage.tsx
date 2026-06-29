import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { fetchMyProfile, updateMyProfile, requestEmailChange, registerMyCard, fetchMyCards, renameMyCard, deleteMyCard } from '../../api/me';
import { ApiError } from '../../types/error';
import type { UserProfile } from '../../types/auth';
import type { UseAuth } from '../../hooks/useAuth';
import type { MeCardListItem } from '../../types/user';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';
import { isWebUSBSupported } from '../../utils/browser';
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

// ===== プロフィール編集ダイアログ =====

interface ProfileEditDialogProps {
  profile: UserProfile;
  token: string;
  onUpdated: (updated: UserProfile) => void;
  onSessionInvalidated: () => void;
  onClose: () => void;
}

function ProfileEditDialog({
  profile,
  token,
  onUpdated,
  onSessionInvalidated,
  onClose,
}: ProfileEditDialogProps) {
  const [name, setName] = useState(profile.name);
  const [fullName, setFullName] = useState(profile.full_name);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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
      setTimeout(() => {
        onClose();
      }, 1200);
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

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="myprofile-dialog"
      onCancel={onClose}
      onClick={handleBackdropClick}
    >
      <div className="myprofile-dialog__inner">
        <div className="myprofile-dialog__header">
          <h2 className="myprofile-dialog__title">プロフィール編集</h2>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>
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
          <div className="myprofile-dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
              disabled={submitting}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting || !hasChanges}
            >
              {submitting ? '更新中...' : '更新'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

// ===== NFCカード登録ダイアログ =====

interface NfcCardDialogProps {
  token: string;
  existingCards: MeCardListItem[];
  onRegistered: (card: MeCardListItem) => void;
  onClose: () => void;
}

function NfcCardDialog({ token, existingCards, onRegistered, onClose }: NfcCardDialogProps) {
  const webUSBSupported = isWebUSBSupported();
  const { status, idm, errorMessage, connect, readIdm, disconnect, reset } = useWebUSBFeliCa();
  const [cardName, setCardName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alreadyRegistered =
    status === 'success' && idm ? (existingCards.find((c) => c.card_idm === idm) ?? null) : null;

  useEffect(() => {
    dialogRef.current?.showModal();
    return () => {
      disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PaSoRi 接続完了後、自動でカード読み取り開始
  useEffect(() => {
    if (status === 'connected') {
      setRegisterError(null);
      setRegisterSuccess(null);
      readIdm();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnect() {
    reset();
    setRegisterError(null);
    setRegisterSuccess(null);
    await connect();
  }

  async function handleRegister() {
    if (!idm) return;
    setRegisterError(null);
    setRegisterSuccess(null);
    setRegistering(true);
    try {
      const res = await registerMyCard(token, {
        card_idm: idm,
        name: cardName.trim() || undefined,
      });
      const newCard: MeCardListItem = {
        card_id: res.card_id,
        card_idm: res.card_idm,
        name: res.name,
        is_active: res.is_active,
        created_at: new Date().toISOString(),
      };
      onRegistered(newCard);
      setRegisterSuccess(`カードを登録しました。`);
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setRegisterError('このカードはすでに登録されています。');
          return;
        }
        if (err.status === 401) {
          setRegisterError('セッションが切れました。再ログインしてください。');
          return;
        }
      }
      setRegisterError('カードの登録に失敗しました。もう一度お試しください。');
    } finally {
      setRegistering(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  const nfcStatusLabel: Record<string, string> = {
    idle: '未接続',
    connecting: '接続中...',
    connected: '接続済み',
    reading: 'カードをかざしてください...',
    success: '読み取り成功',
    error: 'エラー',
  };

  return (
    <dialog
      ref={dialogRef}
      className="myprofile-dialog"
      onCancel={onClose}
      onClick={handleBackdropClick}
    >
      <div className="myprofile-dialog__inner">
        <div className="myprofile-dialog__header">
          <h2 className="myprofile-dialog__title">NFCカード登録</h2>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {!webUSBSupported ? (
          <div className="form-alert form-alert--warn" role="alert">
            このブラウザは WebUSB に対応していません。Chrome または Edge をご利用ください。
          </div>
        ) : (
          <div className="nfc-card-dialog__body">
            <p className="nfc-card-dialog__hint">
              「接続」ボタンを押して PaSoRi を選択すると、自動的にカードの読み取りを開始します。
            </p>

            <div className={`nfc-status nfc-status--${status}`}>
              {nfcStatusLabel[status] ?? status}
            </div>

            {idm && (
              <div className="nfc-card-dialog__idm">
                <span className="nfc-card-dialog__idm-label">読み取り IDm:</span>
                <code className="nfc-card-dialog__idm-value">{idm}</code>
              </div>
            )}

            {status === 'success' && alreadyRegistered && (
              <div className="form-alert form-alert--warn" role="status">
                {alreadyRegistered.name
                  ? `「${alreadyRegistered.name}」としてすでに登録されています。`
                  : 'このカードはすでに登録されています（名前なし）。'}
              </div>
            )}

            {status === 'success' && idm && !alreadyRegistered && !registerSuccess && (
              <div className="form-field">
                <label htmlFor="nfc-card-name" className="form-label">
                  カード名 <span className="form-hint">（任意）</span>
                </label>
                <input
                  id="nfc-card-name"
                  type="text"
                  className="form-input"
                  placeholder="例: 通勤定期、会社ID"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  maxLength={50}
                  disabled={registering}
                />
              </div>
            )}

            {errorMessage && (
              <div className="form-alert form-alert--error" role="alert">
                {errorMessage}
              </div>
            )}
            {registerError && (
              <div className="form-alert form-alert--error" role="alert">
                {registerError}
              </div>
            )}
            {registerSuccess && (
              <div className="form-alert form-alert--success" role="status">
                {registerSuccess}
              </div>
            )}

            <div className="nfc-card-dialog__buttons">
              {(status === 'idle' || status === 'error') && (
                <button type="button" className="btn btn--primary" onClick={handleConnect}>
                  接続
                </button>
              )}
              {status === 'success' && idm && !alreadyRegistered && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleRegister}
                  disabled={registering || registerSuccess !== null}
                >
                  {registering ? '登録中...' : 'このカードを登録'}
                </button>
              )}
              {(status === 'success' || status === 'error') && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    reset();
                    setRegisterError(null);
                    setRegisterSuccess(null);
                  }}
                >
                  やり直す
                </button>
              )}
            </div>
          </div>
        )}

        <div className="myprofile-dialog__actions myprofile-dialog__actions--right">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
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
  const [cards, setCards] = useState<MeCardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState<'profile' | 'nfc' | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState('');
  const [renamingCardId, setRenamingCardId] = useState<string | null>(null);

  const token = auth.token!;

  useEffect(() => {
    Promise.all([fetchMyProfile(token), fetchMyCards(token)])
      .then(([p, c]) => {
        setProfile(p);
        setCards(c);
        setLoading(false);
      })
      .catch(() => {
        setLoadError('プロフィールの取得に失敗しました。');
        setLoading(false);
      });
  }, [token]);

  const handleSessionInvalidated = useCallback((msg?: string) => {
    setSessionMessage(msg || 'メールアドレスが変更されたため、セッションが無効化されました。再度ログインしてください。');
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

      {/* プロフィール情報 */}
      <section className="myprofile-section myprofile-section--info">
        <div className="myprofile-section__header">
          <h2 className="myprofile-section__title">プロフィール情報</h2>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setOpenDialog('profile')}
          >
            編集
          </button>
        </div>
        <dl className="myprofile-info-list">
          <dt className="myprofile-info-term">表示名</dt>
          <dd className="myprofile-info-desc">{profile.name}</dd>
          <dt className="myprofile-info-term">氏名</dt>
          <dd className="myprofile-info-desc">{profile.full_name}</dd>
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

      {/* NFCカード */}
      <section className="myprofile-section">
        <div className="myprofile-section__header">
          <h2 className="myprofile-section__title">NFCカード</h2>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setOpenDialog('nfc')}
          >
            カードを登録
          </button>
        </div>
        {cards.length === 0 ? (
          <p className="myprofile-section__desc">登録済みのカードはありません。</p>
        ) : (
          <ul className="myprofile-card-list">
            {cards.map((card) => (
              <li key={card.card_id} className="myprofile-card-item">
                <div className="myprofile-card-item__info">
                  {editingCardId === card.card_id ? (
                    <form
                      className="myprofile-card-item__rename-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setRenamingCardId(card.card_id);
                        try {
                          const updated = await renameMyCard(token, card.card_id, {
                            name: editingCardName.trim() || null,
                          });
                          setCards((prev) =>
                            prev.map((c) => (c.card_id === card.card_id ? updated : c)),
                          );
                          setEditingCardId(null);
                        } catch {
                          // 失敗しても編集モードは維持
                        } finally {
                          setRenamingCardId(null);
                        }
                      }}
                    >
                      <input
                        type="text"
                        className="form-input form-input--sm"
                        value={editingCardName}
                        onChange={(e) => setEditingCardName(e.target.value)}
                        maxLength={50}
                        placeholder="カード名（空欄で削除）"
                        autoFocus
                        disabled={renamingCardId === card.card_id}
                      />
                      <div className="myprofile-card-item__rename-actions">
                        <button
                          type="submit"
                          className="btn btn--primary btn--sm"
                          disabled={renamingCardId === card.card_id}
                        >
                          {renamingCardId === card.card_id ? '保存中...' : '保存'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEditingCardId(null)}
                          disabled={renamingCardId === card.card_id}
                        >
                          キャンセル
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {card.name && (
                        <span className="myprofile-card-item__name">{card.name}</span>
                      )}
                      <code className="myprofile-card-item__idm">{card.card_idm}</code>
                    </>
                  )}
                </div>
                <span className={`myprofile-card-item__status${card.is_active ? '' : ' myprofile-card-item__status--inactive'}`}>
                  {card.is_active ? '有効' : '無効'}
                </span>
                <span className="myprofile-card-item__date">
                  登録日: {new Date(card.created_at).toLocaleDateString('ja-JP')}
                </span>
                {editingCardId !== card.card_id && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    aria-label={`カード ${card.card_idm} の名前を変更`}
                    disabled={deletingCardId === card.card_id}
                    onClick={() => {
                      setEditingCardId(card.card_id);
                      setEditingCardName(card.name ?? '');
                    }}
                  >
                    名前変更
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--danger btn--sm myprofile-card-item__delete"
                  aria-label={`カード ${card.card_idm} を削除`}
                  disabled={deletingCardId === card.card_id}
                  onClick={async () => {
                    if (!window.confirm(`カード (IDm: ${card.card_idm}) を削除しますか？`)) return;
                    setDeletingCardId(card.card_id);
                    try {
                      await deleteMyCard(token, card.card_id);
                      setCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
                    } catch {
                      // 失敗時は何もしない（一覧はそのまま）
                    } finally {
                      setDeletingCardId(null);
                    }
                  }}
                >
                  {deletingCardId === card.card_id ? '削除中...' : '削除'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EmailChangeForm token={token} />

      {/* ダイアログ */}
      {openDialog === 'profile' && (
        <ProfileEditDialog
          profile={profile}
          token={token}
          onUpdated={setProfile}
          onSessionInvalidated={handleSessionInvalidated}
          onClose={() => setOpenDialog(null)}
        />
      )}
      {openDialog === 'nfc' && (
        <NfcCardDialog
          token={token}
          existingCards={cards}
          onRegistered={(card) => setCards((prev) => [...prev, card])}
          onClose={() => setOpenDialog(null)}
        />
      )}
    </main>
  );
}
