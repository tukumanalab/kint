# 本番環境デプロイ・設定ガイド

本ドキュメントは、リモートサーバー `tukumana.si.aoyama.ac.jp` に勤怠管理システム `kint` をデプロイする際の設定手順、システム構成、およびデプロイ中に発生した不具合と修正内容をまとめたものです。

---

## 1. システム構成概要

本番環境は以下のミドルウェアおよび実行環境で構成されています。

- **サーバー**: Ubuntu 24.04.3 LTS (x86_64)
- **Webサーバー**: Nginx 1.24.0 (リバースプロキシおよびフロントエンド静的ファイルの配信)
- **プロセス管理**: PM2 6.0.13 (FastAPI バックエンドの永続化・自動起動管理)
- **バックエンド**: Python 3.12.3 / FastAPI (依存関係管理には `uv` を使用)
- **フロントエンド**: React 18+ / TypeScript / Vite (ViteによるSPAビルド成果物をNginxで配信)
- **データベース**: SQLite (aiosqlite による非同期操作)
- **公開サブパス**: `https://tukumana.si.aoyama.ac.jp/kint/`

---

## 2. 公開サブパス配下での動作設計

既存のアプリケーション（`m-pass`など）がドメインのルート `/` を使用しているため、本システムは `/kint/` サブパス配下で動作するように設定されています。

### 2.1 フロントエンド (Vite) のベースパス設定
- ファイル: `frontend/vite.config.ts`
Viteのビルドオプション `base` を `/kint/` に設定しています。
```typescript
export default defineConfig({
  base: '/kint/',
  // ...
})
```

### 2.2 Google OAuth 2.0 の承認済みリダイレクトURI
Google Cloud Console の認証情報設定において、**「承認済みのリダイレクト URI」**に以下を追加する必要があります。
- `https://tukumana.si.aoyama.ac.jp/kint/`

---

## 3. Nginx 設定

フロントエンドの静的配信と、バックエンドAPI・Google ログインコールバックのプロキシ設定を分離して管理しています。

### 3.1 設定ファイルの配置 (`/etc/nginx/kint.conf`)
新規に設定ファイルを作成し、`/kint/` 配下のルーティングを定義します。

```nginx
# 1. フロントエンドの静的アセット配信とクライアントルーティング対応
location /kint/ {
    alias /srv/kint/frontend/dist/;
    index index.html;
    try_files $uri $uri/ /kint/index.html;
}

# 2. Google OAuth2 コールバック (POST) を FastAPI バックエンドへプロキシする設定
# (Google Identity Services は認証情報を HTML form_post (POST) で返却します)
location = /kint {
    if ($request_method = POST) {
        proxy_pass http://127.0.0.1:8000/;
        break;
    }
}
location = /kint/ {
    if ($request_method = POST) {
        proxy_pass http://127.0.0.1:8000/;
        break;
    }
}

# 3. バックエンド API および Swagger UI / OpenAPI のプロキシ設定
location /api/ {
    proxy_pass http://127.0.0.1:8000/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /docs {
    proxy_pass http://127.0.0.1:8000/docs;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /redoc {
    proxy_pass http://127.0.0.1:8000/redoc;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /openapi.json {
    proxy_pass http://127.0.0.1:8000/openapi.json;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 3.2 既存設定へのインクルード
既存のサーバーブロック設定ファイル（例：`/etc/nginx/sites-enabled/m-pass`）内の `server { ... }` ブロックの末尾付近に、以下を追記してリロードします。

```nginx
    # kint用のプロキシ設定を追加
    include /etc/nginx/kint.conf;
```

Nginxの設定テストと反映コマンド:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. PM2 によるバックエンド起動設定

FastAPI バックエンドプロセスは、リポジトリルートにある `ecosystem.config.js` を利用して PM2 で起動・管理されます。ポートは `8000` を使用します。

### 4.1 PM2 設定内容
- ファイル: `ecosystem.config.js`
```javascript
module.exports = {
  apps: [
    {
      name: 'kint-backend',
      script: 'uv',
      args: 'run uvicorn kint.main:app --host 127.0.0.1 --port 8000',
      cwd: '/srv/kint/src',
      interpreter: 'none',
      env: {
        PYTHONPATH: '/srv/kint/src',
      },
    },
  ],
};
```

### 4.2 起動・再起動コマンド
```bash
# プロセスの新規起動
pm2 start ecosystem.config.js

# プロセスの再起動
pm2 restart kint-backend

# ログの確認
pm2 logs kint-backend
```

---

## 5. デプロイ作業手順 (新規デプロイ・更新時)

1. **コードのプッシュと同期**
   - ローカルでの修正を GitHub へプッシュ。
   - リモートサーバーの作業ディレクトリ（例: `/srv/kint`）へ移動し、`git pull` を実行。

2. **データベースのマイグレーション**
   - バックエンドの依存関係を構築した上で、Alembic を用いてマイグレーションを適用します。
   ```bash
   cd /srv/kint
   uv sync
   uv run alembic upgrade head
   ```

3. **フロントエンドのビルド**
   - 本番用の Google Client ID を環境変数に渡してビルドを行います。
   ```bash
   cd /srv/kint/frontend
   npm ci
   VITE_GOOGLE_CLIENT_ID=138259612704-gtcg1asac7k62r6agdunn6e6kmpoqal0.apps.googleusercontent.com npm run build
   ```
   ※ ビルド成果物 `dist` が `/srv/kint/frontend/dist` に配置され、Nginx から直接静的配信されます。

4. **プロセスの再起動**
   ```bash
   pm2 restart kint-backend
   ```

---

## 6. トラブルシューティングと修正履歴

本番デプロイおよび初回接続テストの際に発生したいくつかの不具合と、その解決策です。

### 6.1 Googleログイン完了後の「リダイレクト先白紙」問題
- **現象**: Google 認証後に `POST /kint` からコールバックを受け取った際、画面が真っ白になり遷移が停止していました。
- **原因**: 認証情報を `sessionStorage` に格納して SPA に飛ばす Python のハンドラで、相対リダイレクトパスとして `./` を返していました。しかし、リクエストの URL に末尾スラッシュがない（例: `https://.../kint`）場合、ブラウザが `./` をドメインのルート `/` と解釈してしまい、別アプリの領域へ遷移していたためでした。
- **解決策**: Python ハンドラ (`src/kint/main.py`) で返却する HTML 内の JavaScript ロジックを修正し、`window.location.pathname` から動的にベースのパスを取得し、末尾スラッシュを補完した上でリダイレクトを行うロジックへ変更しました。

### 6.2 リダイレクトHTMLの script 閉じタグエラー
- **現象**: 6.1 の修正を適用した際、JavaScript 自体がブラウザで実行されない問題が追加で発生しました。
- **原因**: `main.py` 内で返却する HTML で、スクリプトの閉じタグをエスケープした `<\/script>`（Python内では `\\/`）と記述していたため、ブラウザが script ブロックの終了を正しくパースできず、構文エラーとなっていました。
- **解決策**: エスケープを排除した通常の `</script>` に書き換えました。

### 6.3 未登録ユーザーログイン時の画面遷移バグ
- **現象**: Google ログインは通るものの、システムに登録されていないアカウントの場合、コンソールに `/api/v1/auth/google 401 (Unauthorized)` エラーが出力されたまま画面が切り替わりませんでした。
- **原因**: 
  - 1) `ApiError` クラスが `Error` を継承する際、プロトタイプの設定 (`Object.setPrototypeOf`) が行われていなかったため、本番等のトランスパイル後の環境で `instanceof ApiError` の判定が `false` となり、未登録エラー (`USER_NOT_REGISTERED`) の検知に失敗していました。
  - 2) リダイレクトで戻った際、画面ステート (`guestPage`) が初期値 `'home'` に戻るため、登録画面（`<RegisterPage />`）の表示条件である `guestPage === 'login'` に合致しなくなっていました。
- **解決策**:
  - `frontend/src/types/error.ts` の `ApiError` コンストラクタでプロトタイプを明示的にセットしました。
  - `frontend/src/hooks/useAuth.ts` にて、`instanceof` に依存しないオブジェクトプロパティによるダックタイピング判定を追加しました。
  - `frontend/src/App.tsx` の未ログイン判定ブロックの最優先処理として、`pendingIdToken` が存在する場合は無条件で `<RegisterPage />` を表示するロジックに変更しました。

### 6.4 Google IDトークンデコード時の名前の文字化け
- **現象**: 新規登録画面（`<RegisterPage />`）で表示される Google アカウントのプロフィール名に、特殊なクォート（`“` `”`）などのマルチバイト文字が含まれている場合、名前が文字化け（例: `Koji â€œ Yokobondâ€  Yokokawa`）していました。
- **原因**: ID トークンデコードの際、`window.atob()` の結果（バイナリ文字列）をそのまま `JSON.parse()` していたため、UTF-8 のマルチバイト文字が Latin1 として解釈されてしまっていました。
- **解決策**: `decodeGoogleIdToken` 関数 ([RegisterPage.tsx](file:///Users/ky/Documents/workspace/kint/frontend/src/components/Register/RegisterPage.tsx)) 内で、`atob` の結果を `Uint8Array` に変換し、`TextDecoder('utf-8')` を用いて正しく UTF-8 デコード処理を行うように修正しました。
