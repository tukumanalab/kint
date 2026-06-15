import { useEffect, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import {
  getUsers,
  createUser,
  patchUser,
  deleteUser,
  exportUsers,
  importUsers,
  fetchUserCards,
  registerUserCard,
  renameUserCard,
  deleteUserCard,
} from '../../api/user';
import { ApiError } from '../../types/error';
import type { UserResponse, UserCreateRequest, UserPatchRequest, MeCardListItem } from '../../types/user';
import type { UseAuth } from '../../hooks/useAuth';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';
import { isWebUSBSupported } from '../../utils/browser';
import './UserManagementPage.css';
import '../MyProfile/MyProfilePage.css';

interface Props {
  auth: UseAuth;
}

type ModalMode = { kind: 'create' } | { kind: 'edit'; user: UserResponse } | null;

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  employee: '従業員',
};

function apiErrorMessage(err: ApiError): string {
  if (err.status === 409) {
    if (err.body.code === 'ACCOUNT_ID_CONFLICT') return 'このアカウントIDはすでに使用されています。';
    if (err.body.code === 'EMAIL_CONFLICT') return 'このメールアドレスはすでに使用されています。';
    if (err.body.code === 'LAST_ADMIN') return '最後の有効な管理者は変更・削除できません。';
  }
  return err.body.message || '操作に失敗しました。もう一度お試しください。';
}

// ===== ユーザーフォームモーダル =====

interface FormModalProps {
  mode: ModalMode;
  onClose: () => void;
  onSaved: (user: UserResponse) => void;
  token: string;
}

function UserFormModal({ mode, onClose, onSaved, token }: FormModalProps) {
  const editing = mode?.kind === 'edit' ? mode.user : null;

  const [accountId, setAccountId] = useState(editing?.id ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [fullName, setFullName] = useState(editing?.full_name ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [role, setRole] = useState<'admin' | 'employee'>(editing?.role ?? 'employee');
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let saved: UserResponse;
      if (mode?.kind === 'create') {
        const payload: UserCreateRequest = {
          id: accountId.trim(),
          name: name.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          role,
        };
        saved = await createUser(token, payload);
      } else if (mode?.kind === 'edit' && editing) {
        const payload: UserPatchRequest = {};
        if (name.trim() !== editing.name) payload.name = name.trim();
        if (fullName.trim() !== editing.full_name) payload.full_name = fullName.trim();
        if (email.trim() !== editing.email) payload.email = email.trim();
        if (role !== editing.role) payload.role = role;
        if (isActive !== editing.is_active) payload.is_active = isActive;
        if (Object.keys(payload).length === 0) {
          onClose();
          return;
        }
        saved = await patchUser(token, editing.id, payload);
      } else {
        return;
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorMessage(err) : '操作に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={mode?.kind === 'create' ? 'ユーザー登録' : 'ユーザー編集'}>
      <div className="modal-box">
        <h2 className="modal-title">{mode?.kind === 'create' ? 'ユーザー登録' : 'ユーザー編集'}</h2>
        <form className="user-form" onSubmit={handleSubmit} noValidate>
          {mode?.kind === 'create' ? (
            <div className="form-field">
              <label htmlFor="account-id" className="form-label">アカウントID <span className="required">*</span></label>
              <input
                id="account-id"
                type="text"
                className="form-input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                minLength={3}
                maxLength={50}
                required
                disabled={submitting}
                autoComplete="username"
              />
              <p className="form-hint">3〜50文字、英数字と記号 _.@+- が利用可能</p>
            </div>
          ) : (
            <div className="form-field">
              <label htmlFor="account-id" className="form-label">アカウントID</label>
              <input
                id="account-id"
                type="text"
                className="form-input"
                value={accountId}
                disabled
                readOnly
              />
            </div>
          )}
          <div className="form-field">
            <label htmlFor="name" className="form-label">表示名 <span className="required">*</span></label>
            <input
              id="name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="full-name" className="form-label">氏名 <span className="required">*</span></label>
            <input
              id="full-name"
              type="text"
              className="form-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={100}
              required
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="email" className="form-label">メールアドレス <span className="required">*</span></label>
            <input
              id="email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="role" className="form-label">ロール <span className="required">*</span></label>
            <select
              id="role"
              className="form-input"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}
              disabled={submitting}
            >
              <option value="employee">従業員</option>
              <option value="admin">管理者</option>
            </select>
          </div>
          {mode?.kind === 'edit' && (
            <div className="form-field">
              <label className="form-label form-label--checkbox">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={submitting}
                />
                有効
              </label>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">{error}</div>
          )}
          <div className="modal-actions">
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
              disabled={submitting || !accountId.trim() || !name.trim() || !fullName.trim() || !email.trim()}
            >
              {submitting ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== 削除確認モーダル =====

interface DeleteModalProps {
  user: UserResponse;
  hard?: boolean;
  onClose: () => void;
  onDeleted: (userId: string, hard: boolean) => void;
  token: string;
}

function DeleteConfirmModal({ user, hard = false, onClose, onDeleted, token }: DeleteModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setSubmitting(true);
    try {
      await deleteUser(token, user.id, hard);
      onDeleted(user.id, hard);
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorMessage(err) : '削除に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="削除確認">
      <div className="modal-box">
        <h2 className="modal-title">{hard ? 'ユーザー完全削除' : 'ユーザー削除'}</h2>
        {hard ? (
          <p className="modal-message">
            <strong>{user.full_name}</strong>（{user.id} / {user.email}）を<strong>完全に削除</strong>します。<br />
            <span className="text-danger" style={{ color: '#e53e3e', fontWeight: 'bold', display: 'block', marginTop: '0.5rem' }}>
              警告: この操作は取り消せません。出退勤履歴、シフト、カード情報などのすべての関連データもデータベースから完全に削除されます。
            </span>
          </p>
        ) : (
          <p className="modal-message">
            <strong>{user.full_name}</strong>（{user.id} / {user.email}）を無効化します。<br />
            この操作は論理削除です。後から有効化できます。
          </p>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            disabled={submitting}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting ? '削除中...' : hard ? '完全に削除する' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== インポート結果モーダル =====

interface ImportResultModalProps {
  result: {
    imported_count: number;
    updated_count: number;
    failed_count: number;
    errors: Array<{ id: string; code: string; message: string }>;
  };
  onClose: () => void;
}

function ImportResultModal({ result, onClose }: ImportResultModalProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="インポート結果">
      <div className="modal-box modal-box--wide">
        <h2 className="modal-title">インポート処理結果</h2>
        <div className="import-result-summary">
          <p>
            新規追加: <strong>{result.imported_count}</strong> 件
          </p>
          <p>
            更新: <strong>{result.updated_count}</strong> 件
          </p>
          <p>
            スキップ（エラー）:{' '}
            <strong className={result.failed_count > 0 ? 'text-danger' : ''}>
              {result.failed_count}
            </strong>{' '}
            件
          </p>
        </div>

        {result.errors && result.errors.length > 0 && (
          <div className="import-errors-section">
            <h3 className="import-errors-title">エラーが発生したユーザー一覧</h3>
            <div className="import-errors-list-wrapper">
              <table className="import-errors-table">
                <thead>
                  <tr>
                    <th>ユーザーID</th>
                    <th>エラー種別</th>
                    <th>詳細メッセージ</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((err, idx) => (
                    <tr key={idx}>
                      <td>
                        <code>{err.id}</code>
                      </td>
                      <td>
                        <span className="error-code-badge">{err.code}</span>
                      </td>
                      <td className="error-message-text">{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== メインページ =====

export function UserManagementPage({ auth }: Props) {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [modal, setModal] = useState<ModalMode>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserResponse | null>(null);
  const [isHardDelete, setIsHardDelete] = useState(false);
  const [nfcTargetUser, setNfcTargetUser] = useState<UserResponse | null>(null);

  const token = auth.token!;

  const [importResult, setImportResult] = useState<{
    imported_count: number;
    updated_count: number;
    failed_count: number;
    errors: Array<{ id: string; code: string; message: string }>;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setActionError(null);
    setIsExporting(true);
    try {
      const data = await exportUsers(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.href = url;
      a.download = `users_backup_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError('エクスポートに失敗しました。');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionError(null);
    setIsImporting(true);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const json = JSON.parse(text);
        if (!Array.isArray(json)) {
          throw new Error('インポート用データはJSON配列である必要があります。');
        }
        const res = await importUsers(token, json);
        setImportResult(res);

        // ユーザー一覧をリロード
        setIsLoading(true);
        const resUsers = await getUsers(token);
        setUsers(resUsers.users);
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : 'インポートに失敗しました。ファイル形式を確認してください。'
        );
      } finally {
        setIsImporting(false);
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setActionError('ファイルの読み込みに失敗しました。');
      setIsImporting(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  useEffect(() => {
    let cancelled = false;
    getUsers(token)
      .then((res) => {
        if (!cancelled) setUsers(res.users);
      })
      .catch(() => {
        if (!cancelled) setLoadError('ユーザー一覧の取得に失敗しました。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleSaved(saved: UserResponse) {
    setUsers((prev) => {
      const idx = prev.findIndex((u) => u.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setModal(null);
  }

  function handleDeleted(userId: string, hard: boolean) {
    if (hard) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: false } : u)),
      );
    }
    setDeleteTarget(null);
    setIsHardDelete(false);
  }

  return (
    <main className="user-mgmt-page">
      <div className="user-mgmt-header">
        <h1 className="user-mgmt-title">ユーザー管理</h1>
        <div className="user-mgmt-actions">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleExport}
            disabled={isExporting || isImporting}
          >
            {isExporting ? '保存中...' : '一括保存 (JSON)'}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isExporting || isImporting}
          >
            {isImporting ? '復元中...' : '一括復元'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setModal({ kind: 'create' })}
            disabled={isExporting || isImporting}
          >
            + ユーザー登録
          </button>
        </div>
      </div>

      {actionError && (
        <div className="user-mgmt-error" style={{ marginBottom: '1rem' }} role="alert">
          {actionError}
        </div>
      )}

      {isLoading && <p className="user-mgmt-loading">読み込み中...</p>}
      {loadError && (
        <div className="user-mgmt-error" role="alert">{loadError}</div>
      )}

      {!isLoading && !loadError && (
        <div className="user-table-wrapper">
          <table className="user-table">
            <thead>
              <tr>
                <th>アカウントID</th>
                <th>氏名</th>
                <th>表示名</th>
                <th>メールアドレス</th>
                <th>ロール</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="user-table__empty">ユーザーが登録されていません</td>
                </tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className={user.is_active ? '' : 'user-table__row--inactive'}>
                  <td>{user.id}</td>
                  <td>{user.full_name}</td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`role-badge role-badge--${user.role}`}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${user.is_active ? 'status-badge--active' : 'status-badge--inactive'}`}>
                      {user.is_active ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="user-table__actions">
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={() => setModal({ kind: 'edit', user })}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={() => setNfcTargetUser(user)}
                    >
                      カード
                    </button>
                    {user.id !== 'system' && (
                      user.is_active ? (
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => {
                            setDeleteTarget(user);
                            setIsHardDelete(false);
                          }}
                        >
                          削除
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => {
                            setDeleteTarget(user);
                            setIsHardDelete(true);
                          }}
                        >
                          完全削除
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserFormModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          token={token}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          hard={isHardDelete}
          onClose={() => {
            setDeleteTarget(null);
            setIsHardDelete(false);
          }}
          onDeleted={handleDeleted}
          token={token}
        />
      )}
      {importResult && (
        <ImportResultModal
          result={importResult}
          onClose={() => setImportResult(null)}
        />
      )}
      {nfcTargetUser && (
        <UserNfcCardsModal
          user={nfcTargetUser}
          onClose={() => setNfcTargetUser(null)}
          token={token}
        />
      )}
    </main>
  );
}

// ===== 管理者用 NFCカード管理ダイアログ =====

interface UserNfcCardsModalProps {
  user: UserResponse;
  token: string;
  onClose: () => void;
}

function UserNfcCardsModal({ user, token, onClose }: UserNfcCardsModalProps) {
  const [cards, setCards] = useState<MeCardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState('');
  const [renamingCardId, setRenamingCardId] = useState<string | null>(null);

  const webUSBSupported = isWebUSBSupported();
  const { status, idm, errorMessage, connect, readIdm, disconnect, reset } = useWebUSBFeliCa();
  const [cardName, setCardName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const alreadyRegistered =
    status === 'success' && idm ? (cards.find((c) => c.card_idm === idm) ?? null) : null;

  // カード一覧ロード
  useEffect(() => {
    fetchUserCards(token, user.id)
      .then((c) => {
        setCards(c);
        setLoading(false);
      })
      .catch(() => {
        setError('カード情報の取得に失敗しました。');
        setLoading(false);
      });
  }, [token, user.id]);

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
      const res = await registerUserCard(token, user.id, {
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
      setCards((prev) => [...prev, newCard]);
      setRegisterSuccess(`カードを登録しました。`);
      setCardName('');
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setRegisterError('このカードはすでに登録されています。');
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
    reading: 'カードをかざしてください（最大5秒）...',
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
          <h2 className="myprofile-dialog__title">{user.full_name} のNFCカード管理</h2>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 既存カード一覧 */}
        <div className="nfc-card-dialog__body" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>登録済みのカード</h3>
          {loading && <p>読み込み中...</p>}
          {error && <div className="form-alert form-alert--error" role="alert">{error}</div>}
          {!loading && !error && cards.length === 0 && (
            <p className="myprofile-section__desc" style={{ color: '#718096', fontSize: '0.9rem' }}>登録済みのカードはありません。</p>
          )}
          {!loading && !error && cards.length > 0 && (
            <ul className="myprofile-card-list" style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              {cards.map((card) => (
                <li key={card.card_id} className="myprofile-card-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #edf2f7' }}>
                  <div className="myprofile-card-item__info" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {editingCardId === card.card_id ? (
                      <form
                        className="myprofile-card-item__rename-form"
                        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setRenamingCardId(card.card_id);
                          try {
                            const updated = await renameUserCard(token, user.id, card.card_id, {
                              name: editingCardName.trim() || null,
                            });
                            setCards((prev) =>
                              prev.map((c) => (c.card_id === card.card_id ? updated : c)),
                            );
                            setEditingCardId(null);
                          } catch {
                            // ignore
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
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                        />
                        <button
                          type="submit"
                          className="btn btn--primary btn--sm"
                          disabled={renamingCardId === card.card_id}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEditingCardId(null)}
                          disabled={renamingCardId === card.card_id}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                        >
                          キャンセル
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="myprofile-card-item__name" style={{ fontWeight: '500', fontSize: '0.9rem' }}>
                          {card.name || '（名前なしカード）'}
                        </span>
                        <code className="myprofile-card-item__idm" style={{ fontSize: '0.8rem', color: '#4a5568' }}>{card.card_idm}</code>
                      </>
                    )}
                  </div>
                  {editingCardId !== card.card_id && (
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={deletingCardId === card.card_id}
                        onClick={() => {
                          setEditingCardId(card.card_id);
                          setEditingCardName(card.name ?? '');
                        }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      >
                        名前変更
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={deletingCardId === card.card_id}
                        onClick={async () => {
                          if (!window.confirm(`カード (IDm: ${card.card_idm}) を削除しますか？`)) return;
                          setDeletingCardId(card.card_id);
                          try {
                            await deleteUserCard(token, user.id, card.card_id);
                            setCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
                          } catch {
                            // ignore
                          } finally {
                            setDeletingCardId(null);
                          }
                        }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 新規登録セクション */}
        <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>カードを新規登録</h3>
        {!webUSBSupported ? (
          <div className="form-alert form-alert--warn" role="alert">
            このブラウザは WebUSB に対応していません。Chrome または Edge をご利用ください。
          </div>
        ) : (
          <div className="nfc-card-dialog__body">
            <p className="nfc-card-dialog__hint" style={{ fontSize: '0.85rem', color: '#718096', marginBottom: '1rem' }}>
              「接続」ボタンを押して PaSoRi を選択すると、自動的にカードの読み取りを開始します。
            </p>

            <div className={`nfc-status nfc-status--${status}`} style={{ marginBottom: '1rem' }}>
              {nfcStatusLabel[status] ?? status}
            </div>

            {idm && (
              <div className="nfc-card-dialog__idm" style={{ marginBottom: '1rem' }}>
                <span className="nfc-card-dialog__idm-label">読み取り IDm:</span>
                <code className="nfc-card-dialog__idm-value">{idm}</code>
              </div>
            )}

            {status === 'success' && alreadyRegistered && (
              <div className="form-alert form-alert--warn" role="status" style={{ marginBottom: '1rem' }}>
                {alreadyRegistered.name
                  ? `「${alreadyRegistered.name}」としてすでに登録されています。`
                  : 'このカードはすでにこのユーザーに登録されています。'}
              </div>
            )}

            {status === 'success' && idm && !alreadyRegistered && !registerSuccess && (
              <div className="form-field" style={{ marginBottom: '1rem' }}>
                <label htmlFor="nfc-card-name" className="form-label">
                  カード名 <span className="form-hint">（任意）</span>
                </label>
                <input
                  id="nfc-card-name"
                  type="text"
                  className="form-input"
                  placeholder="例: 社員証、交通系IC"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  maxLength={50}
                  disabled={registering}
                />
              </div>
            )}

            {errorMessage && (
              <div className="form-alert form-alert--error" role="alert" style={{ marginBottom: '1rem' }}>
                {errorMessage}
              </div>
            )}
            {registerError && (
              <div className="form-alert form-alert--error" role="alert" style={{ marginBottom: '1rem' }}>
                {registerError}
              </div>
            )}
            {registerSuccess && (
              <div className="form-alert form-alert--success" role="status" style={{ marginBottom: '1rem' }}>
                {registerSuccess}
              </div>
            )}

            <div className="nfc-card-dialog__buttons" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
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

        <div className="myprofile-dialog__actions myprofile-dialog__actions--right" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
