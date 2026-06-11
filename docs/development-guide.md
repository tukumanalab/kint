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

## 本番デプロイ (PM2 + Nginx)

### 前提

- Linux サーバーに以下がインストールされていること:
  - Node.js (v20.x 推奨)
  - PM2
  - Python (3.12+)
  - uv (パッケージマネージャ)
  - Nginx
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
| `DATABASE_URL` | SQLite のデータベースURL（例: `sqlite+aiosqlite:///kint.db`）|

```bash
# SECRET_KEY の生成例
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 2. フロントエンドのビルド

フロントエンドをビルドし、生成された静的ファイルを Nginx で配信できるように配置します。

```bash
# 依存関係のインストールとビルド
cd frontend
npm ci
VITE_GOOGLE_CLIENT_ID=<Google Client ID> npm run build
```
ビルド完了後、`frontend/dist` ディレクトリが生成されます。これを Nginx が参照する静的ファイルの公開ディレクトリ（例: `/var/www/kint/frontend/dist`）にコピーまたはシンボリックリンクを張ります。

### 3. バックエンドの起動

PM2 を使ってバックエンド（FastAPI）をデーモンとして起動します。

```bash
# 依存関係のインストール
uv sync --frozen --no-dev

# データベースマイグレーションの実行
uv run alembic upgrade head

# PM2 による起動
pm2 start ecosystem.config.js

# 起動状態の確認
pm2 status

# ログ確認
pm2 logs kint-backend
```

### 4. Nginx の設定

`/etc/nginx/sites-available/kint` などに設定を作成し、有効化します（具体的な設定は [nginx/kint.conf](file:///Users/ky/Documents/workspace/kint/nginx/kint.conf) を参照）。

```bash
# 設定ファイルのシンボリックリンクを作成して有効化
sudo ln -s /path/to/kint/nginx/kint.conf /etc/nginx/sites-enabled/kint

# 設定のテストと再起動
sudo nginx -t
sudo systemctl restart nginx
```

### 5. 管理コマンド (PM2)

```bash
# 再起動
pm2 restart kint-backend

# 停止
pm2 stop kint-backend

# 登録解除
pm2 delete kint-backend
```

### 6. DB バックアップ

SQLite のデータベースファイルを直接バックアップします。

```bash
# バックアップ (kint.db をコピー)
cp kint.db backups/kint.$(date +%Y%m%d).db
```

---

## ログ確認

### ログファイル

バックエンドは起動時に `logs/kint.log` へ JSON Lines 形式でログを出力します
（5 MB ローテーション、最大 5 世代保持）。

```bash
# リアルタイム追尾（整形表示）
tail -f logs/kint.log | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        print(f\"{d['timestamp']}  {d['level']:<8}  {d['logger']}  {d['message']}\")
    except Exception:
        print(line)
"

# Docker 本番環境でのログ確認
docker compose logs -f api
```

ログレベルは環境変数 `DEBUG=true` で DEBUG に、それ以外は INFO になります。

### Web UI ログビューア

管理者でログインすると、ナビバーに **「ログ」** が表示されます。

| 機能 | 説明 |
|------|------|
| レベルフィルタ | DEBUG / INFO / WARNING / ERROR / CRITICAL で絞り込み |
| キーワード検索 | メッセージ・ロガー名を部分一致で検索 |
| 最大件数 | 50 / 100 / 200 / 500 / 1000 件から選択 |
| 自動更新 | 10 秒ごとに最新ログを取得 |

API: `GET /api/v1/logs?level=ERROR&keyword=同期&limit=100`（管理者 JWT 必須）

### 勤怠データ変更履歴の確認

勤怠データに修正が行われた場合の変更履歴は、管理者および一般従業員の双方が日別勤怠詳細カレンダーから確認できます。

| 機能 | 説明 |
|------|------|
| 履歴確認ボタン | 日別勤怠詳細を表示した際、各日の「操作」列に表示されます（勤怠レコードが存在する場合のみ）。管理者は他従業員の履歴、従業員は自分自身の履歴を確認できます。 |
| 履歴モーダル | ボタンをクリックすると、変更日時、変更実行者（管理者・従業員）、変更前後の出退勤時刻、および修正理由（必須）がタイムライン形式で時系列に表示されます。 |

API: `GET /api/v1/attendance/{attendance_id}/history`（管理者および対象の従業員 JWT 必須）

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
