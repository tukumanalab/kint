# Kint - NFC勤怠管理システム

## プロジェクト概要

NFC (FeliCa IDm) カードによるチェックイン/チェックアウト機能を持つ勤怠管理システム。
2つのコンポーネントで構成される:

1. **Server アプリ** — FastAPI バックエンド API (勤怠・認証・管理)
2. **Web アプリ** — 勤怠情報の管理・参照・修正・打刻 (React SPA + WebUSB)

Google Calendar のシフトカレンダーと照合して勤怠管理を行う。

## 技術スタック

### サーバー (Linux)
- **Backend API**: Python 3.12+ / FastAPI
- **Frontend (Web管理画面)**: React 18+ / TypeScript / Vite (SPA)
- **Database**: SQLite (aiosqlite)
- **ORM**: SQLAlchemy 2.0+ (async) + aiosqlite
- **Migration**: Alembic
- **Calendar**: Google Calendar API (シフト照合)
- **Auth**: セッションベース認証 (JWT トークン)
- **Deploy**: Docker Compose (Linux server)
- **Test**: Backend: pytest + pytest-asyncio / Frontend: Vitest + React Testing Library

### クライアント (ブラウザ)
- **Web App**: React 18+ / TypeScript / Vite
- **NFC**: WebUSB + PaSoRi (RC-S380/RC-S300) — FeliCa IDm 読み取り
- **通信**: バックエンド API に HTTPS で打刻データを送信

## ディレクトリ構成

```
kint/
├── AGENTS.md
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── alembic.ini
├── alembic/
│   └── versions/
├── src/
│   └── kint/
│       ├── __init__.py
│       ├── main.py              # FastAPI app entry
│       ├── config.py            # 設定管理
│       ├── db.py                # DB接続・セッション (SQLite)
│       ├── models/              # SQLAlchemy models
│       │   ├── __init__.py
│       │   ├── user.py
│       │   ├── card.py
│       │   └── attendance.py
│       ├── schemas/             # Pydantic schemas
│       ├── routers/             # APIルーター
│       │   ├── __init__.py
│       │   ├── auth.py
│       │   ├── attendance.py
│       │   ├── admin.py
│       │   └── calendar.py
│       ├── services/            # ビジネスロジック
│       │   ├── attendance.py
│       │   ├── calendar.py      # Google Calendar 連携
│       │   └── user.py
│       └── static/              # Vite ビルド成果物配信用
├── frontend/                    # React SPA — Web管理画面
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                 # API クライアント
│       ├── components/          # React コンポーネント
│       │   ├── Dashboard.tsx
│       │   ├── ShiftCalendar.tsx
│       │   ├── AttendanceList.tsx
│       │   └── Admin/
│       ├── hooks/               # カスタムフック
│       │   └── useAuth.ts
│       ├── pages/               # ページコンポーネント
│       └── types/               # TypeScript 型定義
├── desktop/                     # 旧Desktop打刻アプリ（移行完了後に撤去予定）
├── tests/                       # Backend テスト
│   ├── conftest.py
│   ├── test_attendance.py
│   ├── test_calendar.py
│   └── test_auth.py
└── .github/
```

## コーディング規約

### Python (Backend + Desktop App)
- Ruff でフォーマット・リント (line-length = 100)
- 型ヒント必須 (全関数の引数・返り値)
- docstring は日本語で簡潔に

### TypeScript (Web Frontend)
- ESLint + Prettier でフォーマット
- 厳格な TypeScript (`strict: true`)
- コンポーネントは関数コンポーネント + hooks
- `any` 禁止

### 共通
- コミットメッセージは日本語、prefix 付き: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- テストは `tests/` (Backend), `frontend/src/**/*.test.tsx` (React)
- 環境変数は `.env` で管理、`config.py` で Pydantic Settings を使う

## アーキテクチャ方針

```
[ブラウザ(WebUSB)]                [Linux Server]              [ブラウザ]
┌─────────────┐    HTTPS/REST    ┌─────────────┐             ┌─────────────┐
│ Punch UI    │ ─────────────→  │  FastAPI     │  ←───────── │ Admin UI    │
│ + PaSoRi    │  打刻・カード登録  │  Backend    │  管理・参照   │ React SPA   │
│ WebUSB      │                  │  + SQLite   │             │             │
└─────────────┘                  └─────────────┘             └─────────────┘
  NFC読み取り                      Google Calendar
```

- **Backend**: Router → Service → Repository パターン。ルーターはHTTPのみ、ビジネスロジックはサービス層
- **Web Frontend**: React SPA。勤怠の参照・修正・管理・打刻。API通信は `frontend/src/api/` に集約
- **WebUSB 打刻**: ブラウザから PaSoRi を WebUSB で利用し、取得した IDm をバックエンド API に POST
- **Google Calendar連携**: バックエンドでGoogle Calendar APIを呼び出し、シフトデータを取得・照合
- **依存性注入**: FastAPI の Depends を活用
- **非同期**: DB操作は全て async/await (aiosqlite)
- **エラーハンドリング**: カスタム例外クラス → HTTPException へ変換
- **実行環境分離**: Server（Python/FastAPI）と Frontend（Node.js/React）は実行環境と依存関係を分離する

## ビルド・テスト

```bash
# === サーバー側 ===

# Backend 依存関係インストール
uv sync

# Frontend 依存関係インストール
cd frontend && npm install

# Backend 開発サーバー起動
uv run uvicorn src.kint.main:app --reload --host 0.0.0.0 --port 8000

# Frontend 開発サーバー起動
cd frontend && npm run dev

# Backend テスト
uv run pytest tests/ -v

# Frontend テスト
cd frontend && npm test

# リント
uv run ruff check src/ tests/
uv run ruff format src/ tests/
cd frontend && npm run lint

# マイグレーション
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"

# Docker（本番）
docker compose up -d

# Server 用環境変数テンプレート
cp .env.example .env

# WebUSB 動作確認はブラウザ上で実施（対応ブラウザ + HTTPS 環境）

# 対応ブラウザ（確定）
# - 公式サポート: Windows 11 + Chrome / Edge（最新安定版）
# - 準サポート: Windows 10 + Chrome / Edge（最新安定版）
# - 非サポート: Firefox / Safari / モバイルブラウザ
```

## データモデル概要

- **User**: 管理者・従業員 (role, name, email, password_hash, google_calendar_id)
- **Card**: NFCカード (card_idm, user_id, is_active) — FeliCa IDm で識別
- **Attendance**: 出退勤記録 (user_id, check_in, check_out, date, card_idm)
- **Shift**: シフト情報 (user_id, date, start_time, end_time, google_event_id)

## NFC (WebUSB + PaSoRi) 概要

- Web ブラウザ上の React アプリで動作
- WebUSB 経由で Sony PaSoRi (RC-S380/RC-S300) に接続
- WebUSB-FeliCa ライブラリで IDm を取得
- 取得した IDm をバックエンド API に POST して打刻・カード登録を行う
- ブラウザ配信によりクライアント配布を不要化

## Google Calendar 連携

- Google Calendar API v3 でシフトカレンダーの予定を取得
- サービスアカウントまたは OAuth2 で認証
- シフト予定と実際の出退勤を照合してレポート生成

## マルチエージェント構成

このプロジェクトでは以下のカスタムエージェントが利用可能:

- `@architect` - システム設計・API設計・コンポーネント設計
- `@backend` - バックエンドAPI実装 (FastAPI + SQLite)
- `@frontend` - React SPA Web管理画面の実装
- `@database` - DB設計・マイグレーション・クエリ最適化 (SQLite)
- `@nfc` - WebUSB + PaSoRi 連携設計/実装支援
- `@reviewer` - コードレビュー・品質チェック
- `@devops` - Docker・デプロイ・CI/CD・Windows exe ビルド
