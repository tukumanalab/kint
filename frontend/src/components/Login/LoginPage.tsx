import { GoogleLogin } from '@react-oauth/google';
import type { UseAuth } from '../../hooks/useAuth';
import './LoginPage.css';

interface Props {
  auth: UseAuth;
}

export function LoginPage({ auth }: Props) {
  return (
    <main className="login-page">
      <div className="login-card">
        <h1 className="login-title">Kint 管理画面</h1>
        {auth.error && <p className="login-error">{auth.error}</p>}
        <div className="login-google-btn">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              if (credentialResponse.credential) {
                auth.loginWithGoogle(credentialResponse.credential).catch(() => {});
              }
            }}
            onError={() => {
              // エラーは useAuth 側で管理するため、ここでは何もしない
            }}
            ux_mode="redirect"
          />
        </div>
        {auth.isLoading && <p className="login-loading">ログイン中...</p>}
      </div>
    </main>
  );
}
