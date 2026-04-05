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
