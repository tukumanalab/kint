import { useState, useCallback, useEffect } from 'react';
import { postLogin, getMe } from '../api/auth';
import { ApiError } from '../types/error';
import type { UserProfile } from '../types/auth';

const STORAGE_KEY = 'kint_access_token';

export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuth {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  login: (accountId: string, password: string) => Promise<void>;
  logout: () => void;
}

export function useAuth(): UseAuth {
  const storedToken = localStorage.getItem(STORAGE_KEY);
  const [state, setState] = useState<AuthState>({
    token: storedToken,
    user: null,
    isLoading: storedToken !== null,
    error: null,
  });

  // 起動時にトークンが残っていれば /auth/me でユーザー情報を復元する
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return;
    getMe(token)
      .then((user) => {
        setState({ token, user, isLoading: false, error: null });
      })
      .catch(() => {
        // 無効なトークンは破棄する
        localStorage.removeItem(STORAGE_KEY);
        setState({ token: null, user: null, isLoading: false, error: null });
      });
  }, []);

  const login = useCallback(async (accountId: string, password: string): Promise<void> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await postLogin({ account_id: accountId, password });
      localStorage.setItem(STORAGE_KEY, res.access_token);
      setState({ token: res.access_token, user: res.user, isLoading: false, error: null });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? 'アカウントIDまたはパスワードが正しくありません'
          : 'ログインに失敗しました。もう一度お試しください。';
      setState((s) => ({ ...s, isLoading: false, error: message }));
      throw err;
    }
  }, []);

  const logout = useCallback((): void => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ token: null, user: null, isLoading: false, error: null });
  }, []);

  return { token: state.token, user: state.user, isLoading: state.isLoading, error: state.error, login, logout };
}
