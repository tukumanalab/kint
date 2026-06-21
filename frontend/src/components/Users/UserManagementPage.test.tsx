import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagementPage } from './UserManagementPage';
import * as userApi from '../../api/user';
import type { UseAuth } from '../../hooks/useAuth';
import type { UserResponse } from '../../types/user';

const mockToken = 'test-token';

const mockAdminUser: UserResponse = {
  id: 'admin.user',
  name: 'admin',
  full_name: '管理 太郎',
  email: 'admin@example.com',
  role: 'admin',
  is_active: true,
  created_at: '2026-04-01T00:00:00',
  updated_at: '2026-04-01T00:00:00',
};

const mockEmployeeUser: UserResponse = {
  id: 'employee.taro',
  name: 'taro',
  full_name: '山田 太郎',
  email: 'taro@example.com',
  role: 'employee',
  is_active: true,
  created_at: '2026-04-01T00:00:00',
  updated_at: '2026-04-01T00:00:00',
};

const mockInactiveUser: UserResponse = {
  id: 'employee.hanako',
  name: 'hanako',
  full_name: '鈴木 花子',
  email: 'hanako@example.com',
  role: 'employee',
  is_active: false,
  created_at: '2026-04-01T00:00:00',
  updated_at: '2026-04-01T00:00:00',
};

function makeAuth(overrides: Partial<UseAuth> = {}): UseAuth {
  return {
    token: mockToken,
    user: {
      id: 'admin.user',
      role: 'admin',
      name: 'admin',
      full_name: '管理 太郎',
      email: 'admin@example.com',
    },
    isLoading: false,
    error: null,
    pendingIdToken: null,
    loginWithGoogle: vi.fn(),
    register: vi.fn(),
    cancelRegister: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe('UserManagementPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ユーザー一覧を表示する', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({
      users: [mockAdminUser, mockEmployeeUser, mockInactiveUser],
    });

    render(<UserManagementPage auth={makeAuth()} />);

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('管理 太郎')).toBeInTheDocument();
      expect(screen.getByText('山田 太郎')).toBeInTheDocument();
      expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    });
  });

  it('無効ユーザーには削除ボタンの代わりに完全削除ボタンが表示される', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({
      users: [mockInactiveUser],
    });

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('鈴木 花子'));

    const rows = screen.getAllByRole('row');
    const inactiveRow = rows.find((r) => r.textContent?.includes('鈴木 花子'));
    const deleteBtn = inactiveRow?.querySelector('[class*="btn--danger"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn?.textContent).toBe('完全削除');
  });

  it('ユーザー登録フォームを開いて送信できる', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({ users: [] });
    const createdUser: UserResponse = {
      ...mockEmployeeUser,
      id: 'new@example.com',
      name: 'new',
      full_name: '新規 ユーザー',
      email: 'new@example.com',
    };
    vi.spyOn(userApi, 'createUser').mockResolvedValue(createdUser);

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('+ ユーザー登録'));

    fireEvent.click(screen.getByText('+ ユーザー登録'));
    expect(screen.getByRole('dialog', { name: 'ユーザー登録' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText(/氏名/), { target: { value: '新規 ユーザー' } });
    fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'new@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(userApi.createUser).toHaveBeenCalledWith(mockToken, {
        id: 'new@example.com',
        name: 'new',
        full_name: '新規 ユーザー',
        email: 'new@example.com',
        role: 'employee',
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByText('新規 ユーザー')).toBeInTheDocument();
    });
  });

  it('ユーザー編集フォームで情報を更新できる', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({ users: [mockEmployeeUser] });
    const updated: UserResponse = { ...mockEmployeeUser, name: 'taro2' };
    vi.spyOn(userApi, 'patchUser').mockResolvedValue(updated);

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('山田 太郎'));

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    fireEvent.click(editButtons[0]);

    expect(screen.getByRole('dialog', { name: 'ユーザー編集' })).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/表示名/);
    fireEvent.change(nameInput, { target: { value: 'taro2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(userApi.patchUser).toHaveBeenCalledWith(mockToken, 'employee.taro', { name: 'taro2' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('削除確認モーダルで論理削除できる', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({ users: [mockEmployeeUser] });
    vi.spyOn(userApi, 'deleteUser').mockResolvedValue(undefined);

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('山田 太郎'));

    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.getByRole('dialog', { name: '削除確認' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(userApi.deleteUser).toHaveBeenCalledWith(mockToken, 'employee.taro', false);
      expect(screen.queryByRole('dialog')).toBeNull();
      // is_active=false になったことを状態バッジで確認
      expect(screen.getByText('無効')).toBeInTheDocument();
    });
  });

  it('削除確認モーダルで完全削除できる', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({ users: [mockInactiveUser] });
    vi.spyOn(userApi, 'deleteUser').mockResolvedValue(undefined);

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('鈴木 花子'));

    fireEvent.click(screen.getByRole('button', { name: '完全削除' }));
    expect(screen.getByRole('dialog', { name: '削除確認' })).toBeInTheDocument();
    expect(screen.getByText(/警告: この操作は取り消せません。/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '完全に削除する' }));

    await waitFor(() => {
      expect(userApi.deleteUser).toHaveBeenCalledWith(mockToken, 'employee.hanako', true);
      expect(screen.queryByRole('dialog')).toBeNull();
      // ユーザー一覧から完全に削除されていること
      expect(screen.queryByText('鈴木 花子')).toBeNull();
    });
  });

  it('ユーザー取得失敗時にエラーを表示する', async () => {
    vi.spyOn(userApi, 'getUsers').mockRejectedValue(new Error('network error'));

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('ユーザー一覧の取得に失敗しました。')).toBeInTheDocument();
    });
  });

  it('検索キーワードを入力して、名前やメールで正しくフィルタリングできる', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({
      users: [mockAdminUser, mockEmployeeUser, mockInactiveUser],
    });

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('山田 太郎'));

    const searchInput = screen.getByPlaceholderText('名前、氏名、またはメールアドレスで検索...');

    // "山田" で検索 (氏名一致)
    fireEvent.change(searchInput, { target: { value: '山田' } });
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    expect(screen.queryByText('管理 太郎')).toBeNull();
    expect(screen.queryByText('鈴木 花子')).toBeNull();

    // "hanako" で検索 (表示名/メールアドレス一致)
    fireEvent.change(searchInput, { target: { value: 'hanako' } });
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    expect(screen.queryByText('管理 太郎')).toBeNull();
    expect(screen.queryByText('山田 太郎')).toBeNull();
  });

  it('検索キーワードをクリアすると、全ユーザーの一覧に戻る', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({
      users: [mockAdminUser, mockEmployeeUser, mockInactiveUser],
    });

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('山田 太郎'));

    const searchInput = screen.getByPlaceholderText('名前、氏名、またはメールアドレスで検索...');

    // "山田" で検索
    fireEvent.change(searchInput, { target: { value: '山田' } });
    expect(screen.queryByText('管理 太郎')).toBeNull();

    // クリアボタンを取得してクリック
    const clearBtn = screen.getByRole('button', { name: '検索条件をクリア' });
    fireEvent.click(clearBtn);

    // 全ユーザーが再度表示されることを確認
    expect(screen.getByText('管理 太郎')).toBeInTheDocument();
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    expect(searchInput).toHaveValue('');
  });

  it('検索結果が0件の場合にメッセージが表示される', async () => {
    vi.spyOn(userApi, 'getUsers').mockResolvedValue({
      users: [mockAdminUser],
    });

    render(<UserManagementPage auth={makeAuth()} />);
    await waitFor(() => screen.getByText('管理 太郎'));

    const searchInput = screen.getByPlaceholderText('名前、氏名、またはメールアドレスで検索...');
    fireEvent.change(searchInput, { target: { value: '存在しないユーザー' } });

    expect(screen.queryByText('管理 太郎')).toBeNull();
    expect(screen.getByText('検索条件に一致するユーザーが見つかりません')).toBeInTheDocument();
  });
});
