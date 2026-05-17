# 開発環境ガイド (macOS + VS Code)

## 前提条件

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Python | 3.12+ | バックエンド実行・テスト |
| uv | 最新版 | Python パッケージ管理 |
| Node.js | 20.x (nvm 推奨) | フロントエンドビルド・テスト |
| VS Code | 最新版 | IDE |

> **Note (nvm ユーザー):** VS Code のタスク・デバッグ起動では `~/.nvm/nvm.sh` を自動的に source するコマンドが設定されています。追加の設定は不要です。

### 推奨 VS Code 拡張 (`.vscode/extensions.json` に定義済み)

- **ms-python.python** — Python 言語サポート
- **ms-python.vscode-pylance** — 型チェック・補完
- **ms-python.debugpy** — Python デバッガ
- **charliermarsh.ruff** — Ruff リント・フォーマット (保存時自動修正)
- **vitest.explorer** — Vitest テストエクスプローラー

VS Code を開いたとき、未インストールの推奨拡張についてポップアップが表示されます。

---

## セットアップ

```bash
# Python 依存インストール
uv sync

# Frontend 依存インストール
cd frontend && npm install
```

### 打刻・シフト連携の環境変数

打刻判定とシフト照合に関わる主な設定は、`.env` で調整できます。

| 変数 | 用途 |
|------|------|
| `SHIFT_ICAL_URL` | iCal 形式のシフト連携 URL。シフト同期の参照先として利用。 |
| `PUNCH_COOLDOWN_SECONDS` | 連続打刻を拒否するクールダウン秒数。 |
| `SHIFT_CHECKIN_EARLY_MINUTES` | シフト開始何分前から「シフト内出勤」と判定するか。 |

`SHIFT_ICAL_URL` が未設定でも API は稼働しますが、シフト外打刻時の確認メッセージでは未設定であることを明示します。

---

## 運用手順（アカウント管理）

### ログイン運用ルール

- ログイン識別子はメールアドレスではなく、`アカウントID`（`users.id`）を使用する。
- メールアドレス（`users.email`）はログインには使わず、連絡先として必須登録とする。
- アカウントID は 3〜50 文字、利用可能文字は英数字と `_.@+-`。
- 既定の管理者ユーザーは未作成時のみ `account ID: manager / password: manager123` で作成される。
- 一度作成された後は、パスワードを変更しても起動時に上書きされない。

### ユーザー登録時の必須項目

管理者によるユーザー登録時は、以下をすべて必須で入力する。

- アカウントID
- 表示名（name）
- 氏名（full_name）
- 連絡用メールアドレス（email）
- ロール（admin / employee）
- パスワード（8〜72文字、英字・数字を各1文字以上含む）

### 重複エラー運用

- アカウントID重複時: `ACCOUNT_ID_CONFLICT`
- メールアドレス重複時: `EMAIL_CONFLICT`

---

## 運用手順（DB再作成）

要件上、段階的マイグレーションではなく DB 作り直しで運用する場合は以下を実施する。

1. アプリを停止する。
2. DB ファイルを削除する（デフォルト: プロジェクト直下の `kint.db`）。
3. スキーマを再作成する。

```bash
# 既定DBを削除
rm -f kint.db

# スキーマ再作成
uv run alembic upgrade head
```

注意:
- DB再作成は既存データを破棄するため、必要なら事前にバックアップを取得する。
- 本番環境で実施する場合は、業務停止時間を確保してから実施する。

---

## 本番デプロイ (Docker)

### 前提

- Docker Engine / Docker Compose V2 がインストール済みであること。
- Google Cloud Console でアプリの **公開 URL** を承認済みリダイレクト URI に追加していること。
  例: `https://your-domain.com/`

### 1. 環境変数を設定する

`.env.example` をコピーして `.env` を作成する。

```bash
cp .env.example .env
```

最低限以下の値を変更する:

| 変数 | 説明 |
|------|------|
| `SECRET_KEY` | JWT 署名用シークレット（長い乱数文字列）|
| `GOOGLE_CLIENT_ID` | バックエンド用 Google Client ID |
| `VITE_GOOGLE_CLIENT_ID` | フロントエンドビルド用 Google Client ID（同じ値）|
| `APP_BASE_URL` | 公開 URL（例: `https://your-domain.com`）|
| `DATABASE_URL` | コンテナ内 SQLite パス（既定: `sqlite+aiosqlite:////data/kint.db`）|

```bash
# SECRET_KEY の生成例
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 2. ビルド & 起動

```bash
# イメージをビルドしてコンテナを起動
docker compose up -d --build

# ログ確認
docker compose logs -f api

# ヘルスチェック確認
curl http://localhost:8000/health
```

起動時に `alembic upgrade head` が自動実行されるため、初回起動時のマイグレーションは不要。

### 3. 停止 / 再起動

```bash
# 停止
docker compose down

# データを保持したまま停止 (volume は残る)
docker compose down --volumes

# イメージごと削除
docker compose down --rmi all
```

### 4. DB バックアップ

SQLite ファイルは `kint_data` Docker volume 内の `/data/kint.db` に格納される。

```bash
# バックアップ
docker run --rm -v kint_kint_data:/data -v "$(pwd)":/backup alpine \
  cp /data/kint.db /backup/kint.$(date +%Y%m%d).db
```

### 5. フロントエンドの Google Client ID

`VITE_GOOGLE_CLIENT_ID` は `npm run build` 時に HTML/JS に埋め込まれる。
ビルド後に変更するにはイメージの再ビルドが必要。

```bash
docker compose build --build-arg VITE_GOOGLE_CLIENT_ID=<新しいID>
```

---

## テスト

### テストエクスプローラー (GUI)

サイドバーのビーカーアイコン (Testing) を開くと、pytest と Vitest のテストが一覧表示されます。

- 個別テストの実行・デバッグはテスト名の横のアイコンから実行できます
- 失敗したテストはアイコンが赤くなり、クリックで詳細を確認できます

### タスクからの実行 (`Ctrl+Shift+P` → "Tasks: Run Test Task")

| タスク名 | 内容 |
|---------|------|
| `backend: テスト実行` | `pytest tests/ -v --tb=short` (デフォルトテストタスク) |
| `backend: テスト実行 (カバレッジ付き)` | pytest + coverage レポートをターミナルに表示 |
| `frontend: テスト実行` | `npm test` (Vitest run) |
| `全テスト実行` | backend → frontend の順に両方実行 |

デフォルトテストタスクは `Ctrl+Shift+P` → "Tasks: Run Test Task" またはキーボードショートカット `Ctrl+Shift+T` で直接起動できます。

### コマンドラインからの実行

```bash
# Backend 全テスト
uv run pytest tests/ -v

# Backend カバレッジ付き
uv run pytest tests/ --cov=src/kint --cov-report=html
# → htmlcov/index.html をブラウザで開いて確認

# Frontend テスト (単発)
cd frontend && npm test

# Frontend テスト (ウォッチモード)
cd frontend && npm run test:watch

# Frontend カバレッジ
cd frontend && npm run test:coverage
```

---

## デバッグ

### デバッグ構成 (`F5` または Run & Debug ビュー)

#### `Backend: pytest (全テスト)`

`tests/` 以下の全テストをデバッガ付きで実行します。テストコード内でブレークポイントを設定して一時停止できます。

1. Run & Debug ビュー (`Ctrl+Shift+D`) を開く
2. ドロップダウンから **"Backend: pytest (全テスト)"** を選択
3. `F5` で起動

#### `Backend: pytest (現在のファイル)`

エディタで開いているテストファイルだけをデバッガ付きで実行します。特定のテストに集中したいときに使います。

1. デバッグしたいテストファイル (`tests/test_*.py`) をエディタで開く
2. Run & Debug ビューで **"Backend: pytest (現在のファイル)"** を選択
3. `F5` で起動

#### `Backend: 開発サーバー (uvicorn)`

FastAPI 開発サーバーをデバッグモードで起動します。API ハンドラにブレークポイントを設定してリクエストを止めて検査できます。

1. Run & Debug ビューで **"Backend: 開発サーバー (uvicorn)"** を選択
2. `F5` で起動 → `http://localhost:8000` で受け付け開始
3. ブレークポイントを設定してフロントエンドまたは curl からリクエストを送ると一時停止します

```bash
# 動作確認例
curl http://localhost:8000/docs
```

#### `Full Stack (Backend + Frontend)`

Vite 開発サーバー起動後に uvicorn をデバッグ起動するコンパウンド構成です。

1. Run & Debug ビューで **"Full Stack (Backend + Frontend)"** を選択
2. `F5` で起動
   - Vite dev server が `http://localhost:5173` で起動
   - uvicorn が `http://localhost:8000` でデバッグ起動
3. ブラウザで `http://localhost:5173` を開いて操作

> **Note:** フロントエンドの JS デバッグは VS Code の Browser デバッグ構成か、ブラウザの DevTools を使ってください。

---

## その他のタスク

`Ctrl+Shift+P` → "Tasks: Run Task" で以下も実行できます。

| タスク名 | 内容 |
|---------|------|
| `frontend: dev サーバー起動` | Vite dev server をバックグラウンドで起動 |
| `backend: lint (ruff)` | ruff check + format --check を実行 |
| `DB: マイグレーション実行` | `alembic upgrade head` を実行 |

---

## テストファイルの置き場所

| 種別 | ディレクトリ | パターン |
|------|------------|---------|
| Backend (pytest) | `tests/` | `test_*.py` |
| Frontend (Vitest) | `frontend/src/**` | `*.test.tsx` / `*.test.ts` |

Backend テストのフィクスチャ (`engine` / `session` / `client`) は `tests/conftest.py` に定義されています。詳細は [test-conventions.instructions.md](../.github/instructions/test-conventions.instructions.md) を参照してください。
