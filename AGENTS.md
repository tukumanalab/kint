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
- **Deploy**: PM2 + Nginx (Linux server) / Docker Compose
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
├── ecosystem.config.js
├── nginx/
│   └── kint.conf
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
│       │   ├── attendance.py
│       │   └── face_descriptor.py # 顔認証ディスクリプタモデル
│       ├── schemas/             # Pydantic schemas
│       │   ├── punch_device.py  # 打刻端末管理スキーマ
│       │   └── face.py          # 顔認証打刻スキーマ
│       ├── routers/             # APIルーター
│       │   ├── __init__.py
│       │   ├── auth.py
│       │   ├── attendance.py
│       │   ├── admin.py
│       │   ├── calendar.py
│       │   ├── punch_device.py  # 打刻端末制限・管理ルーター
│       │   └── face_punch.py    # 顔認証打刻ルーター
│       ├── services/            # ビジネスロジック
│       │   ├── attendance.py
│       │   ├── calendar.py      # Google Calendar 連携
│       │   ├── user.py
│       │   ├── punch_device.py  # 打刻端末サービス
│       │   └── face.py          # 顔認証ディスクリプタ登録・照合サービス
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
│       │   └── punch_device.ts  # 打刻端末 API クライアント
│       ├── components/          # React コンポーネント
│       │   ├── Dashboard.tsx
│       │   ├── ShiftCalendar.tsx
│       │   ├── AttendanceList.tsx
│       │   ├── Admin/
│       │   ├── Face/
│       │   │   ├── FaceRegistration.tsx # 顔データ登録・削除の共通コンポーネント
│       │   │   └── FaceRegistrationDialog.tsx # 登録ダイアログ（マイページ・ユーザー管理で共用）
│       │   ├── Punch/
│       │   │   ├── FacePunchPanel.tsx   # 顔認証打刻パネル（カメラ・自動打刻）
│       │   │   └── FaceAvatar.tsx       # 打刻結果を案内するアバター表示
│       │   └── Settings/
│       │       └── PunchDeviceManager.tsx # 打刻端末管理コンポーネント
│       ├── hooks/               # カスタムフック
│       │   ├── useAuth.ts
│       │   ├── useNfcReader.ts
│       │   ├── useCamera.ts     # カメラ (getUserMedia) 制御フック
│       │   └── usePunchSubmission.ts # 打刻送信共通フック
│       ├── nfc/                 # WebUSB + PaSoRi NFC 通信
│       ├── face/                # ブラウザ内顔ディスクリプタ抽出 (@vladmandic/face-api)
│       │   └── faceEngine.ts
│       ├── pages/               # ページコンポーネント
│       └── types/               # TypeScript 型定義
├── tests/                       # Backend テスト
│       ├── conftest.py
│       ├── test_attendance.py
│       ├── test_calendar.py
│       ├── test_auth.py
│       ├── test_punch_device.py # 打刻端末制限テスト
│       └── test_face_punch.py   # 顔認証打刻テスト
├── .agents/
│   └── skills/
│       └── deploy/
│           └── SKILL.md         # リモートデプロイ手順スキル
└── .github/
```

## コーディング規約

### Python (Backend)
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
- **ドキュメント同時更新の徹底**: Agentがコードや仕様を編集・変更した後は、必ず `AGENTS.md` や `docs/` 配下のドキュメント（API定義, 設計書, 使い方ガイド等）への影響を確認し、必要に応じて直ちに反映・更新すること。
- 仕様の変更があった時は必ず `docs/` にあるドキュメントもそれに合わせて更新すること
- 機能を変更したときには必ず「使い方ガイド」などの関連する操作マニュアルも合わせて更新すること

## アーキテクチャ方針

```
[Linux Server]                            [ブラウザ]
┌─────────────┐    HTTPS/REST    ┌───────────────┐
│  FastAPI      │  ←──────────→  │ React SPA       │
│  Backend     │  打刻・管理・参照  │ + WebUSB/PaSoRi │
│  + SQLite    │                  │ NFC読み取り     │
└─────────────┘                  └───────────────┘
  Google Calendar
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

# 本番ビルド (フロントエンド)
# npm run copy-face-models は顔認証打刻用モデルファイルの配置（build 前に一度実行）
cd frontend && npm ci && npm run copy-face-models && VITE_GOOGLE_CLIENT_ID=<Client_ID> npm run build

# PM2（バックエンド本番起動）
pm2 start ecosystem.config.js

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
- **AttendanceMonthlyComment**: 月次勤務サマリーの管理者共有メモ (year_month PK, body, updated_by_user_id)
- **FaceDescriptor**: 顔認証用の128次元特徴量ディスクリプタ (user_id, descriptor(float32バイナリ), created_at) — 写真は保存しない

## NFC (WebUSB + PaSoRi) 概要

- Web ブラウザ上の React アプリで動作
- WebUSB 経由で Sony PaSoRi (RC-S380/RC-S300) に接続
- WebUSB-FeliCa ライブラリで IDm を取得
- 取得した IDm をバックエンド API に POST して打刻・カード登録を行う
- ブラウザ配信によりクライアント配布を不要化

## 打刻時の効果音再生機能

- **Web Audio API による音色合成**:
  - 打刻状態の遷移時に、ブラウザ上で効果音を鳴らします。
  - 音声アセットの配信やロード失敗のリスクを排除するため、外部音声ファイル（mp3等）を使用せず、ブラウザ標準の `Web Audio API` で動的に周波数を制御してシンセサイズ再生します。
- **再生パターン**:
  - 出勤（`check_in`）: ピピッ（880Hz を 0.08秒 × 2回、間隔 0.12秒）
  - 退勤（`check_out`）: ピプー（880Hz を 0.08秒、その後 587.33Hz を 0.20秒）
  - 打刻取消（`cancelled`など）: ピッ（880Hz を 0.15秒 × 1回）
  - 打刻エラー: ブー（180Hz の鋸歯状波 `sawtooth` を 0.35秒 × 1回）
- **自動再生ポリシー (Autoplay Policy) 回避**:
  - ブラウザの自動再生ブロックを回避するため、「PaSoRiに接続」クリック時、およびフォールバック打刻の「打刻」実行時のユーザーインタラクションを契機に `AudioContext` をあらかじめ有効化（`resume`）します。

## Google Calendar 連携

- Google Calendar API v3 でシフトカレンダーの予定を取得
- サービスアカウントまたは OAuth2 で認証
- シフト予定と実際の出退勤を照合してレポート生成

## 月次勤怠レポートの自動メール通知機能

- **自動メール通知の概要**:
  - 設定された毎月末日の時刻（デフォルト値 `20:00`）に、アクティブな従業員（管理者 `role == 'admin'` は除外、かつメールアドレスが設定されているユーザー）に対し、当月の勤務実績レポートを自動でメール通知します。
- **通知データ**:
  - **1か月ごとの勤務日数**: 当月に実打刻（出勤・退勤）が行われた日数。
  - **1か月ごとの勤務時間**: 当月の丸め処理適用後の勤務時間の合計。
  - **4月からの総勤務時間**: 当年4月1日（または前年4月1日）から当月末までの丸め処理適用後の総勤務時間の合計。
- **設定と制御**:
  - 管理者は「システム設定」画面から自動通知時刻（`monthly_report_time`）を `HH:MM` 形式で編集・保存できます。
  - 通知時刻が保存されると、バックエンドは APScheduler の定期実行スケジュールを月末日の指定時刻で再スケジュールします。空設定にすると自動通知は無効となります。
  - **件名および本文テンプレートのカスタマイズ**: 管理者は「システム設定」画面から月次レポートメールの件名（`monthly_report_subject`）および本文テンプレート（`monthly_report_body`）を自由に変更できます。文面内では `{user_name}`, `{site_name}`, `{year}`, `{month}`, `{last_day}`, `{working_days}`, `{total_requested_hours}`, `{total_working_hours}`, `{yearly_hours}`, `{app_base_url}` などの変数プレースホルダーを利用可能です。

## 打刻端末制限と登録機能

- **デバイス制限の仕組み**:
  - セキュリティと運用の簡便化のため、登録された端末のみ打刻ページ（未ログイン用待ち受け画面）を開くことができます。
  - データベースに端末情報は保存しません。代わりに、管理者が端末を登録する際にバックエンドが署名した長期有効な **Device Punch Token (JWT)** を発行し、ブラウザの `localStorage` に保存します。
  - バックエンドは `X-Punch-Device-Token` ヘッダーから受け取ったトークンの署名が正しいか（管理者が作成した有効なトークンか）を検証するだけでデバイスを特定・許可します。
- **画面遷移の制御**:
  - 一般ユーザー (employee) でログインしている場合、ナビゲーションの「打刻」リンクは非表示となります。また、直接アクセスされた場合は自動で「勤怠一覧」にリダイレクトされます。
  - 初めてその端末で打刻を開いた場合（未登録状態）は、「未登録の端末です」というエラー画面と、管理者ログインへの導線が表示されます。
  - 管理者がログインし、「設定」画面の最下部にある「打刻端末管理」セクションから端末名を入力して登録を行うことで、その端末で誰でも打刻画面を開けるようになります。
  - 管理者は「設定」画面から現在の端末の登録を取り消す（`localStorage` からクリアする）ことができます。

## 顔認証打刻機能

- **概要**:
  - 打刻ページ（未ログイン待ち受け画面）に「顔認証」タブを追加し、ブラウザのカメラで撮影した顔を照合して自動的に出退勤を打刻する機能です。デフォルトでは無効化されており、「システム設定」画面の「顔認証打刻」セクションで管理者が有効化する必要があります。
  - `@vladmandic/face-api`（ブラウザ内 TinyFaceDetector + 128次元特徴量抽出）を用いてブラウザ側で顔ディスクリプタを算出し、**写真そのものはサーバーに送信・保存しません**。サーバーには 128 次元の数値ディスクリプタ（float32バイナリ）のみを保存します（`face_descriptors` テーブル）。
  - 打刻ページと同様、顔照合系 API (`GET /api/v1/face-punch/config`, `POST /api/v1/face-punch/identify`) は `X-Punch-Device-Token` ヘッダー（打刻端末制限機能で発行されたトークン）による端末検証が必須です。
- **顔データの登録**:
  - **従業員本人**: 「マイページ」画面の「顔認証データ」セクション（登録状況を表示）にある「顔を登録」（登録済みなら「登録・削除」）ボタンから登録ダイアログ（`FaceRegistrationDialog`、スマホでは全画面表示）を開き、カメラ同意チェックの上、正面・上下左右の5枚を「📸 撮影」ボタンで1枚ずつ撮影して自身の顔データを登録・削除できます。
  - **管理者による代理登録**: 「ユーザー管理」画面の対象ユーザー行にある「顔データ」ボタンから、Webカメラを使って対象者の顔データを登録・削除できます。
  - **管理者ユーザーへの登録は不可**: 管理者 (`role == 'admin'`) は打刻対象外のため、本人・代理登録のいずれも `ADMIN_FACE_NOT_ALLOWED` エラーとなり登録できません。
- **顔認証テスト**:
  - 顔データ登録ダイアログ（マイページ・ユーザー管理の「顔データ」）で、登録済みの場合に「顔認証をテスト」ボタンが表示されます。カメラを起動し「🔍 テストする」を押すと、実際の打刻と同じ照合ロジックで「現在の顔が本人として認識されるか」を確認できます（`POST /api/v1/me/face/verify`、管理者は `POST /api/v1/users/{user_id}/face/verify`）。
  - 結果は `recognized`（自動打刻）/ `recognized_with_confirmation`（シフト外のため確認ボタン表示）/ `not_recognized`（理由: `too_far` / `other_user_closer` / `ambiguous`）と一致度の距離・しきい値のみを返し、他ユーザーの情報は含みません。トークン発行・打刻は行わず、顔認証打刻設定が無効でも利用できます。顔データ未登録の場合は 404 `FACE_NOT_REGISTERED`。
- **照合ロジック**:
  - 取得したディスクリプタと、登録済み全ユーザー（有効かつ非管理者）の顔ディスクリプタとのユークリッド距離を計算し、最も距離が近いユーザーを候補とします。
  - 当日シフトがある、または24時間以内の未退勤（オープン）勤怠があるユーザーは「シフトあり」として扱われ、しきい値 `face_match_threshold`（デフォルト 0.45）で判定し、一致すればカウントダウン（`face_punch_countdown_seconds`）後に自動打刻します（カウントダウン中は「取消」ボタンでキャンセル可能）。
  - それ以外の「シフト外」ユーザーはより厳しいしきい値 `face_match_threshold_no_shift`（デフォルト 0.38）で判定し、一致した場合も自動打刻はせず「〇〇さんで打刻する / 違う」の確認ボタンで本人確認を求めます。
  - 上位2候補の距離差が 0.05 未満の場合は「あいまい」と判定し、いずれのしきい値を満たしていても不一致として扱います（誤認識防止）。
  - 照合に成功すると、60秒間のみ有効な短命トークン `face_match_token`（JWT）を発行し、打刻 API (`POST /api/v1/punches`) にはこのトークンのみを送信します（打刻方式 `method: "face"`、打刻元 `source: 'webcam_face'`）。
- **アバターと音声案内**:
  - 打刻画面にはイラストアバター（`FaceAvatar`、画像 `frontend/src/assets/punch-avatar.webp`）が表示されます。状態に応じて CSS アニメーションで動きます（待機: 呼吸 / 探索中: 首かしげ / あいさつ: 弾み / 打刻成功: ジャンプ / エラー: 首振り）。口は音声読み上げ中（`speechSynthesis` の onstart〜onend。非対応環境では文字数から見積もった時間）だけ開き、それ以外は閉じます。閉じた口は元画像の開いた口の位置に肌色パッチと口の線を重ねて表現しています（画像を差し替える場合は `FaceAvatar.css` の `.face-avatar__mouth-area` の位置を調整）。`prefers-reduced-motion` 設定時はアニメーションを停止します。
  - 認識時には `speechSynthesis`（Web Speech API）で「おはようございます、〇〇さん」等のあいさつを日本語音声で読み上げます。
  - カメラ開始のクリック操作を契機に音声合成の自動再生制限を事前に解除します。

## ログイン継続時間の設定機能

- **ログイン有効期限のカスタマイズ**:
  - 管理者は「システム設定」画面から、全ユーザーに適用されるログイン継続時間（JWTアクセストークンの有効期限）を時間単位で設定できます。
  - 設定可能な範囲は `1` 〜 `8760` 時間（最大 365 日）で、デフォルト値は `168` 時間（7 日間）です。
  - Google ログイン時および新規アカウント登録時に発行されるアクセストークンの有効期限にこの設定値が動的に適用されます。

## 月次勤怠編集ログ表示機能

- **概要**:
  - 対象年月における勤怠変更履歴（`AttendanceChangeLog`）を時系列で参照・確認する機能です。
  - 「月次勤務サマリー」タイトル横（管理者）および上部コントロール横（一般従業員）に配置された「📝 編集ログ」ボタンからトグル表示可能です。
  - 詳細カレンダーの下部に時系列（変更日時降順）で変更ログ一覧（対象従業員・対象日・操作者・変更理由・変更前後の設定）が表示されます。
- **権限と表示範囲**:
  - **管理者**: 「月次勤務サマリー」横の「📝 編集ログ」ボタンを押すと、当月の**全従業員**の編集ログ一覧を表示します。月次サマリーテーブルで特定の従業員行をクリックした場合はそのユーザーのログに絞り込まれます。すでに選択されている従業員行を再クリックすると選択が解除され、全員分の表示に戻ります。
  - **一般従業員**: 自身の当月編集ログのみを参照・閲覧できます。


## 勤怠重複防止と日跨ぎ勤務制御

- **長期放置された未退勤打刻の保護**:
  - 出勤打刻から24時間以上退勤打刻が行われないまま放置された場合、その後の打刻は過去の未退勤レコードへの退勤打刻として吸収されず、当日の「新規出勤打刻」として処理されます。
- **シフト終了後打刻時の自動退勤補完（23:59補完）**:
  - シフト終了時刻以降に出勤打刻を行い、退勤打刻を行わないまま帰宅した場合、翌日以降の未退勤自動補完処理（`auto_complete_missing_checkouts`）によって、当日の **23:59:00 (JST)** を退勤打刻時刻として自動補完します。これにより、数日にわたる日跨ぎ勤務の発生を回避します。
- **日跨ぎ勤怠の入力補助と警告**:
  - 勤怠の修正・追加ダイアログにおいて、退勤日が出勤日と異なる（日跨ぎ）場合は「⚠️ 日跨ぎ (YYYY-MM-DD)」注意バッジおよび「出勤日と同日にする」ボタンが表示されます。
  - 出退勤の差が24時間以上離れている場合は登録時にブラウザの確認ダイアログが表示されます。
  - 7日間（168時間）を超えるような極端な日跨ぎ登録はバックエンドで `ATTENDANCE_RANGE_TOO_LARGE` エラーとしてブロックされます。
- **重複エラーメッセージの改善**:
  - 勤怠重複チェック（`_check_overlap`）で重複対象レコードの退勤日が日跨ぎとなっている場合、エラーメッセージに退勤日の年月日（`YYYY-MM-DD HH:MM:SS`）が明示され、重複状況を即座に把握できます。

## 初期登録アカウントとその保護

- **manager**: システムの初期管理者ユーザーです。別の管理者アカウント作成後に無効化することが推奨されます（削除してもシステム起動時に自動的に再作成されます）。
- **system**: 自動退勤などのシステムスケジュール処理や変更履歴（監査ログ）の更新者として登録される内部専用のシステムユーザーです。
  - **誤削除防止策**: システムの安定稼働のために必須となるため、ユーザー管理画面のUI上で `system` ユーザーに対する「削除」および「完全削除」ボタンは非表示に制限されています。

## マルチエージェント構成

このプロジェクトでは以下のカスタムエージェントが利用可能です。各エージェントの役割と制約、アプローチは以下の通りです。

---

### `@architect` (システムアーキテクト)
システム全体のアーキテクチャ設計、API設計、コンポーネント設計、技術選定を行います。

#### 役割
- システム全体のアーキテクチャ設計
- API設計 (OpenAPI仕様)
- コンポーネント間の依存関係設計
- 技術選定の判断と根拠提示
- シーケンス図の作成
- 概念レベルの ER 図（エンティティとリレーションの全体像）

#### 制約
- コードの実装はしない（設計のみ）
- 既存のアーキテクチャ方針（Router → Service → Repository）に従う
- 実装の詳細は `@backend`, `@frontend`, `@database`, `@nfc` に委譲する
- 物理モデル設計（カラム型、インデックス等）は `@database` に委譲する

#### アプローチ
1. 要件を分析し、影響範囲を特定する
2. 既存コードを読んで現状のアーキテクチャを把握する
3. 設計案を複数提示し、トレードオフを説明する
4. 決定事項をドキュメントとして残す

#### 出力フォーマット
- Mermaid記法でダイアグラムを含める
- API設計はOpenAPI形式のYAMLスニペットで示す
- 判断の根拠を必ず添える

---

### `@backend` (バックエンド開発者)
FastAPIバックエンドAPI、ビジネスロジック、Google Calendar連携等の実装を行います。

#### 役割
- FastAPI ルーター・エンドポイント実装
- Pydantic スキーマ定義
- サービス層のビジネスロジック実装（基本的な CRUD クエリ含む）
- Google Calendar API 連携 (`services/calendar.py`)
- 依存性注入の設計
- エラーハンドリング
- 実装した機能のテスト作成

#### 制約
- Router → Service → Repository パターンに従う
- 全関数に型ヒントを付ける
- DB操作は全て async/await
- ビジネスロジックをルーターに書かない
- 複雑なクエリ最適化・インデックス設計は `@database` に委譲する

#### アプローチ
1. 関連する既存コードを確認する
2. Pydantic スキーマを先に定義する
3. サービス層のロジックを実装する
4. ルーターでHTTPエンドポイントとして公開する
5. Ruff でフォーマットを確認する
6. `@reviewer` を呼び出してコードレビューを受け、指摘があれば修正する

---

### `@database` (データベーススペシャリスト)
SQLAlchemyモデル設計、Alembicマイグレーション、クエリ最適化を行います。

#### 役割
- SQLAlchemy 物理モデル設計・実装（カラム型、制約、インデックス）
- Alembic マイグレーション作成
- 複雑なクエリ最適化・インデックス設計
- データ整合性制約の定義
- SQLite の制約を考慮した設計
- 注: 概念 ER 設計は `@architect` が、基本的な CRUD クエリは `@backend` が担当する

#### 制約
- SQLAlchemy 2.0 の Mapped 記法を使う
- DB は SQLite + aiosqlite (async)
- マイグレーションは必ず Alembic 経由
- 生SQL は避け、SQLAlchemy のクエリビルダーを使う
- カラム追加時は NOT NULL にデフォルト値を設定するか、nullable にする
- マイグレーションには downgrade も必ず実装する
- SQLite の制約に注意: ALTER TABLE の制限、型の柔軟性
- `render_as_batch=True` を Alembic で設定する (SQLite の ALTER TABLE 対応)

#### アプローチ
1. 要件からエンティティとリレーションを特定する
2. SQLAlchemy モデルを定義する
3. Alembic でマイグレーションを自動生成する
4. マイグレーションの内容を確認・修正する
5. インデックスの必要性を検討する
6. `@reviewer` を呼び出してコードレビューを受け、指摘があれば修正する

---

### `@frontend` (フロントエンド開発者)
React SPA Web UI、TypeScriptコンポーネント、カスタムフック、APIクライアントの実装を行います。

#### 役割
- React コンポーネント作成・編集 (TypeScript)
- カスタムフック実装 (`useAuth`, `useNfcReader` 等)
- API クライアント (`frontend/src/api/`) の実装
- WebUSB + PaSoRi による NFC 打刻・カード登録 UI
- 勤怠一覧・ダッシュボード・シフトカレンダー・管理画面の UI
- Vite 設定・ビルド最適化
- 注: WebUSB の低レベル通信プロトコルや FeliCa コマンド実装の詳細は `@nfc` に委譲する

#### 制約
- React 18+ / TypeScript / Vite で SPA を構築する
- `any` 禁止、厳格な TypeScript (`strict: true`)
- コンポーネントは関数コンポーネント + hooks パターン
- API通信は `frontend/src/api/` に集約する
- テストは Vitest + React Testing Library
- WebUSB は HTTPS 環境でのみ動作する（開発時は localhost 可）

#### アプローチ
1. ページの目的とユーザーフローを確認する
2. 必要な型定義を `frontend/src/types/` に作成する
3. APIクライアント関数を作成する
4. React コンポーネントを実装する
5. テストを追加する
6. `@reviewer` を呼び出してコードレビューを受け、指摘があれば修正する

---

### `@nfc` (WebUSB+FeliCa通信スペシャリスト)
WebUSB経由のPaSoRi制御、FeliCaコマンドによるIDm取得等の低レベル通信を担当します。

#### 役割
- WebUSB API による PaSoRi (RC-S380/RC-S300) 接続・制御
- FeliCa Polling コマンドの実装（IDm 取得）
- PaSoRi の USB 初期化・コマンドシーケンス
- NFC リーダー接続管理・エラー回復ロジック
- `frontend/src/nfc/` 以下の WebUSB 通信コード全般
- 注: NFC を利用する React コンポーネント・フック・UI は `@frontend` が担当する

#### 制約
- TypeScript で実装する（`any` 禁止、`strict: true`）
- WebUSB API を使用する（HTTPS 環境必須、開発時は localhost 可）
- コードは `frontend/src/nfc/` ディレクトリ以下に配置
- IDm は16桁の大文字hex文字列で正規化して返す
- PaSoRi 切断・未接続時の適切なエラーハンドリングを実装する
- セキュリティ: IDm の漏洩防止（ログ出力時のマスキング等）

#### アプローチ
1. WebUSB でデバイスを要求・接続する
2. PaSoRi の初期化コマンドを送信する
3. FeliCa Polling で IDm を取得する
4. 取得した IDm を呼び出し元に返す
5. `@reviewer` を呼び出してコードレビューを受け、指摘があれば修正する

---

### `@reviewer` (コードレビュアー)
コードレビュー、セキュリティ脆弱性チェック、テスト検証などを行います。

#### 役割
- コードレビュー（品質・可読性・保守性）
- 既存テストの実行・カバレッジ確認
- セキュリティ脆弱性チェック
- 型ヒントの検証
- パフォーマンスの問題指摘
- 注: テスト作成は各実装エージェントが担当し、`@reviewer` はレビューとテスト実行のみ行う

#### 制約
- コードを直接修正しない（指摘のみ）
- OWASP Top 10 を常に意識する
- テスト実行時は既存テストを壊さないことを確認する
- 指摘には修正案を添える

#### 出力フォーマット
```
## レビュー結果

### 🔴 Critical (即修正)
- [ファイル:行] 問題の説明 → 修正案

### 🟡 Warning (要検討)
- [ファイル:行] 問題の説明 → 修正案

### 🟢 Suggestion (改善提案)
- [ファイル:行] 提案内容
```

---

### `@devops` (DevOps/インフラ担当)
PM2, Nginx, Dockerfile, docker-compose, CI/CD設定、システム構築を担当します。

#### 役割
- PM2 / Nginx 設定ファイルの管理・最適化
- Dockerfile / docker-compose.yml の作成・最適化
- CI/CDパイプライン構築（GitHub Actions）
- Linux サーバーデプロイ設定（`.agents/skills/deploy/SKILL.md` のデプロイ手順スキルに従って実施）
- 環境変数・シークレット管理
- SQLite バックアップ・リストア手順

#### 制約
- PM2 と Nginx の組み合わせにおける Google OAuth コールバック (POST /) や SPA フォールバックの設定を適切に行う
- Docker構成も互換性のために維持・サポートする
- シークレットは設定ファイルやイメージに含めない
- SQLite DB ファイルの適切な配置とバックアップ手順を管理する
- NFC読み取りはブラウザの WebUSB で行うため、サーバー側に USB デバイスは不要

#### アプローチ
1. 要件に合ったインフラ構成を確認する
2. PM2, Nginx, Docker 関連設定ファイルを作成・更新する
3. ビルド・起動のテストを行う
4. ドキュメントを更新する

