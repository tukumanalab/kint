---
name: google-oauth-redirect
description: "VS Code integrated browser (Simple Browser) での Google OAuth2 認証セットアップ。Use when setting up Google Sign-In with redirect mode, fixing popup-blocked OAuth errors, configuring Vite dev server middleware for Google form_post callback, or enabling login in VS Code Simple Browser / Electron webview environments."
argument-hint: "Google OAuth / ログインに関する作業内容を記述してください"
---

# Google OAuth2 — Redirect モード実装（開発・本番統合）

## いつ使うか

- VS Code の integrated browser (Simple Browser) でログインしたい
- `Failed to open popup window` エラーが出る
- `ux_mode="popup"` から `ux_mode="redirect"` へ切り替えたい
- Vite (SPA) + `@react-oauth/google` の redirect フローをセットアップしたい
- FastAPI + Docker 本番環境で Google OAuth を動かしたい

## 全体像

`ux_mode="redirect"` では Google が `redirect_uri` に **HTTP POST** で credential を送信する
（`response_mode=form_post`）。ブラウザ JS はリクエストボディを読めないため、
**サーバー側で受け取って sessionStorage 経由で SPA に橋渡し**する。

環境によって受け取り役が異なる：

| 環境 | POST / を受け取る役 |
|------|-------------------|
| 開発 (`npm run dev`) | Vite dev サーバーミドルウェア |
| 本番 (`docker compose up`) | FastAPI `POST /` エンドポイント |

SPA 側（`useAuth.ts`）の処理は共通。

```
[ブラウザ] → Google 認証
  ↓ POST /  {credential: "eyJ..."}
[開発: Vite middleware / 本番: FastAPI POST /]
  ↓ <script>sessionStorage.setItem('google_credential', ...); location.href='/'</script>
[React SPA — useAuth.ts useEffect]
  ↓ sessionStorage から credential を取得 → loginWithGoogle(credential)
[FastAPI POST /api/v1/auth/google]
  ↓ JWT 発行 → ログイン完了
```

---

## セットアップ手順

### 手順 1: Google Cloud Console — リダイレクト URI を登録

1. [console.cloud.google.com](https://console.cloud.google.com) → 「API とサービス」→「認証情報」
2. 対象の OAuth 2.0 クライアント ID を開く
3. **「承認済みのリダイレクト URI」** に以下を追加して保存:
   - `http://localhost:5173/`（開発）
   - `https://your-domain.com/`（本番）
4. 反映まで最大数分かかる場合がある

> **注意**: 「承認済みの JavaScript 生成元」への追加だけでは redirect モードは動作しない。
> リダイレクト URI の登録が別途必要。

---

### 手順 2: `LoginPage.tsx` — `ux_mode="redirect"` に変更

```diff
  <GoogleLogin
    onSuccess={(credentialResponse) => {
      if (credentialResponse.credential) {
        auth.loginWithGoogle(credentialResponse.credential).catch(() => {});
      }
    }}
    onError={() => {}}
-   useOneTap
+   ux_mode="redirect"
  />
```

> `useOneTap` は redirect モードと併用不可のため削除する。

---

### 手順 3: `vite.config.ts` — 開発用 form_post ハンドラーを追加

開発環境で Google が `http://localhost:5173/` に POST してくる credential を受け取る。

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

function googleOAuthCallbackPlugin(): Plugin {
  return {
    name: 'google-oauth-callback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || req.url !== '/') {
          return next()
        }
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          const params = new URLSearchParams(body)
          const credential = params.get('credential')
          if (!credential) return next()
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>
sessionStorage.setItem('google_credential',${JSON.stringify(credential)});
window.location.href='/';
<\/script></head><body>Redirecting...</body></html>`
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), googleOAuthCallbackPlugin()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
```

> `vite.config.ts` 変更後は dev サーバーが自動再起動する（手動再起動不要）。

---

### 手順 4: `useAuth.ts` — sessionStorage から credential を自動ログイン処理

既存の `useEffect`（localStorage トークン復元）の直後に追加する。
開発・本番どちらでも共通で動作する。

```typescript
// Google redirect モード: sessionStorage に保存された credential を自動ログイン処理する
useEffect(() => {
  const credential = sessionStorage.getItem('google_credential');
  if (!credential) return;
  sessionStorage.removeItem('google_credential');
  loginWithGoogle(credential).catch(() => {});
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

> `loginWithGoogle` は `useCallback(fn, [])` で安定しているため空依存配列で問題ない。

---

### 手順 5（本番のみ）: FastAPI エンドポイントと SPA 静的配信を追加

#### 5-1. 依存パッケージ追加 (`pyproject.toml`)

```toml
"python-multipart>=0.0.9",  # Form(...) に必要
"aiofiles>=23.0.0",         # StaticFiles に必要
```

```bash
uv sync
```

#### 5-2. `src/kint/main.py` に追記

```python
import json
from pathlib import Path
from typing import Any

import aiofiles  # noqa: F401  # StaticFiles が内部で使用
from fastapi import Form
from fastapi.exceptions import HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


# ヘルスチェック（Docker HEALTHCHECK 用）
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Google OAuth2 redirect モード コールバック（本番用）
# ※ app.mount("/", ...) より前に登録すること
@app.post("/")
async def google_oauth_callback(credential: str = Form(...)) -> HTMLResponse:
    safe_credential = json.dumps(credential)
    html = (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>\n"
        f"sessionStorage.setItem('google_credential',{safe_credential});\n"
        "window.location.href='/';\n"
        "<\\/script></head><body>Redirecting...</body></html>"
    )
    return HTMLResponse(content=html)


# SPA 静的配信（src/kint/static/ が存在する場合のみ）
class _SPAStaticFiles(StaticFiles):
    """404 時に index.html へフォールバックする SPA 用 StaticFiles。"""

    async def get_response(self, path: str, scope: Any) -> Any:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", _SPAStaticFiles(directory=_STATIC_DIR, html=True), name="spa")
```

> **登録順序**: API ルーター → `POST /` コールバック → `app.mount("/", ...)` の順を守ること。
> マウントはキャッチオールとして機能するため、順序が逆だと POST リクエストが
> StaticFiles に吸収されてしまう。

#### 5-3. `Dockerfile` — マルチステージビルド

```dockerfile
# Stage 1: フロントエンドビルド
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npm run build

# Stage 2: Python ランタイム
FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini ./
# フロントエンドビルド成果物を FastAPI の静的ファイルディレクトリに配置
# → _STATIC_DIR.is_dir() が True になり SPA 配信と POST / コールバックが有効になる
COPY --from=frontend-builder /app/frontend/dist ./src/kint/static/
RUN mkdir -p /data
RUN useradd --system --no-create-home --uid 1001 kint \
    && chown -R kint:kint /app /data
USER kint
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn src.kint.main:app --host 0.0.0.0 --port 8000"]
```

#### 5-4. `docker-compose.yml`

```yaml
services:
  api:
    build:
      context: .
      args:
        VITE_GOOGLE_CLIENT_ID: ${VITE_GOOGLE_CLIENT_ID}
    ports:
      - "8000:8000"
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - DATABASE_URL=sqlite+aiosqlite:////data/kint.db
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - APP_BASE_URL=${APP_BASE_URL:-http://localhost:8000}
    volumes:
      - kint_data:/data
    restart: unless-stopped

volumes:
  kint_data:
```

#### 5-5. Google Cloud Console に本番 URL を追加

**承認済みのリダイレクト URI** に本番 URL を追加:
```
https://your-domain.com/
```

---

## トラブルシューティング

| エラー | 原因 | 対処 |
|--------|------|------|
| `redirect_uri_mismatch` (400) | Cloud Console にリダイレクト URI が未登録 | 手順 1 を実施 |
| `Failed to open popup window` | ux_mode が popup のまま | 手順 2 を実施 |
| ログイン後に画面が更新されない | sessionStorage の credential が読まれていない | 手順 4 が適用されているか確認 |
| HMR で「Rendered more hooks than...」 | HMR によるフック数ズレ | ブラウザをフルリロード (`Cmd+Shift+R`) |
| ボタンを押しても何も起きない | Cloud Console 変更の伝播待ち | 数分待ってから再試行 |
| 本番で `POST /` が 404 | `app.mount` より後に `POST /` を登録している | 登録順序を確認（手順 5-2 参照）|
| 本番でブラウザ直接アクセスが 404 | `_SPAStaticFiles` が適用されていない | `src/kint/static/` にビルド成果物があるか確認 |

---

## 関連ファイル

- [frontend/src/components/Login/LoginPage.tsx](../../../frontend/src/components/Login/LoginPage.tsx)
- [frontend/vite.config.ts](../../../frontend/vite.config.ts)
- [frontend/src/hooks/useAuth.ts](../../../frontend/src/hooks/useAuth.ts)
- [src/kint/main.py](../../../src/kint/main.py)
- [Dockerfile](../../../Dockerfile)
- [docker-compose.yml](../../../docker-compose.yml)
