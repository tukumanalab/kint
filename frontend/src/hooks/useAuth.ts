import { useState, useCallback, useEffect, useRef } from 'react';
import { postGoogleLogin, postRegister, getMe } from '../api/auth';
import { ApiError } from '../types/error';
import type { UserProfile } from '../types/auth';

const STORAGE_KEY = 'kint_access_token';

export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  pendingIdToken: string | null;
}

export interface UseAuth {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  pendingIdToken: string | null;
  loginWithGoogle: (idToken: string) => Promise<void>;
  register: (adminPassword?: string) => Promise<void>;
  cancelRegister: () => void;
  logout: () => void;
}

export function useAuth(): UseAuth {
  const storedToken = localStorage.getItem(STORAGE_KEY);
  const [state, setState] = useState<AuthState>({
    token: storedToken,
    user: null,
    isLoading: storedToken !== null,
    error: null,
    pendingIdToken: null,
  });
  const pendingIdTokenRef = useRef<string | null>(null);

  // 起動時にトークンが残っていれば /auth/me でユーザー情報を復元する
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return;
    getMe(token)
      .then((user) => {
        setState({ token, user, isLoading: false, error: null, pendingIdToken: null });
      })
      .catch(() => {
        // 無効なトークンは破棄する
        localStorage.removeItem(STORAGE_KEY);
        setState({ token: null, user: null, isLoading: false, error: null, pendingIdToken: null });
      });
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string): Promise<void> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await postGoogleLogin(idToken);
      localStorage.setItem(STORAGE_KEY, res.access_token);
      pendingIdTokenRef.current = null;
      setState({ token: res.access_token, user: res.user, isLoading: false, error: null, pendingIdToken: null });
    } catch (err) {
      let isUnregistered = false;
      if (err instanceof ApiError && err.status === 401 && err.body.code === 'USER_NOT_REGISTERED') {
        isUnregistered = true;
      } else if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        (err as Record<string, unknown>).status === 401 &&
        'body' in err
      ) {
        const body = (err as Record<string, unknown>).body;
        if (
          body &&
          typeof body === 'object' &&
          'code' in body &&
          (body as Record<string, unknown>).code === 'USER_NOT_REGISTERED'
        ) {
          isUnregistered = true;
        }
      }

      if (isUnregistered) {
        // 未登録 → 登録画面へ遷移
        pendingIdTokenRef.current = idToken;
        setState((s) => ({ ...s, isLoading: false, error: null, pendingIdToken: idToken }));
        return;
      }
      const message = 'ログインに失敗しました。もう一度お試しください。';
      setState((s) => ({ ...s, isLoading: false, error: message, pendingIdToken: null }));
      throw err;
    }
  }, []);

  // Google redirect モード: sessionStorage に保存された credential を自動ログイン処理する
  useEffect(() => {
    const credential = sessionStorage.getItem('google_credential');
    if (!credential) return;
    sessionStorage.removeItem('google_credential');
    Promise.resolve().then(() => {
      loginWithGoogle(credential).catch(() => {});
    });
  }, [loginWithGoogle]);

  const register = useCallback(async (adminPassword?: string): Promise<void> => {
    const idToken = pendingIdTokenRef.current;
    if (!idToken) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await postRegister(idToken, adminPassword);
      localStorage.setItem(STORAGE_KEY, res.access_token);
      pendingIdTokenRef.current = null;
      setState({ token: res.access_token, user: res.user, isLoading: false, error: null, pendingIdToken: null });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 409
          ? 'このGoogleアカウントはすでに登録されています。ログインし直してください。'
          : 'アカウント登録に失敗しました。もう一度お試しください。';
      setState((s) => ({ ...s, isLoading: false, error: message }));
      throw err;
    }
  }, []);

  const cancelRegister = useCallback((): void => {
    pendingIdTokenRef.current = null;
    setState((s) => ({ ...s, pendingIdToken: null, error: null }));
  }, []);

  const logout = useCallback((): void => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ token: null, user: null, isLoading: false, error: null, pendingIdToken: null });
  }, []);

  return {
    token: state.token,
    user: state.user,
    isLoading: state.isLoading,
    error: state.error,
    pendingIdToken: state.pendingIdToken,
    loginWithGoogle,
    register,
    cancelRegister,
    logout,
  };
}
