import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getUsers, createUser, patchUser, deleteUser } from '../../api/user';
import { ApiError } from '../../types/error';
import type { UserResponse, UserCreateRequest, UserPatchRequest } from '../../types/user';
import type { UseAuth } from '../../hooks/useAuth';
import './UserManagementPage.css';

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
  onClose: () => void;
  onDeleted: (userId: string) => void;
  token: string;
}

function DeleteConfirmModal({ user, onClose, onDeleted, token }: DeleteModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setSubmitting(true);
    try {
      await deleteUser(token, user.id);
      onDeleted(user.id);
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorMessage(err) : '削除に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="削除確認">
      <div className="modal-box">
        <h2 className="modal-title">ユーザー削除</h2>
        <p className="modal-message">
          <strong>{user.full_name}</strong>（{user.id} / {user.email}）を無効化します。<br />
          この操作は論理削除です。後から有効化できます。
        </p>
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
            {submitting ? '削除中...' : '削除する'}
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

  const token = auth.token!;

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

  function handleDeleted(userId: string) {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_active: false } : u)),
    );
    setDeleteTarget(null);
  }

  return (
    <main className="user-mgmt-page">
      <div className="user-mgmt-header">
        <h1 className="user-mgmt-title">ユーザー管理</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setModal({ kind: 'create' })}
        >
          + ユーザー登録
        </button>
      </div>

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
                    {user.is_active && (
                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        onClick={() => setDeleteTarget(user)}
                      >
                        削除
                      </button>
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
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
          token={token}
        />
      )}
    </main>
  );
}
