# Kint アーキテクチャ設計

## 1. 目的
Kint は、正確性、監査性、運用容易性を重視した NFC 勤怠管理システムです。
アーキテクチャは Router -> Service -> Repository を採用し、Web アプリ上で打刻機能と管理機能を提供します。
また、利用者自身による打刻修正を許可し、その際は修正理由を必須とし、変更前後の内容と実行者情報をすべて履歴として記録します。

## 2. システム構成

```mermaid
flowchart LR
  subgraph Server[Linux サーバー]
    Nginx[Nginx]
    API[FastAPI (PM2)]
    Router[Router 層]
    Service[Service 層]
    Repo[Repository 層]
    DB[(SQLite)]
    Calendar[iCal アダプター]
    Mail[Gmail API アダプター]
    Auth[認証 Session/JWT]
    Audit[監査ログ]
    Logger[ログ出力 JSON Lines]
    LogFile[(logs/kint.log)]
  end

  subgraph Browser[Web ブラウザ]
    PunchUI[打刻 UI]
    AdminUI[管理 UI]
    LogUI[ログビューア UI]
    USB[WebUSB-FeliCa アダプター]
    Reader[PaSoRi USB 接続]
    LS[(LocalStorage: デバイストークン)]
  end

  PunchUI --> LS
  PunchUI --> USB --> Reader
  PunchUI -->|HTTPS (SPAリクエスト / API)| Nginx
  AdminUI -->|HTTPS (SPAリクエスト / API)| Nginx
  LogUI -->|HTTPS (SPAリクエスト / API / ログ取得)| Nginx

  Nginx -->|SPA 静的配信| PunchUI
  Nginx -->|SPA 静的配信| AdminUI
  Nginx -->|SPA 静的配信| LogUI
  Nginx -->|リバースプロキシ| API

  API --> Router --> Service --> Repo --> DB
  Service --> Calendar
  Service --> Mail
  API --> Auth
  Service --> Audit
  API --> Logger --> LogFile
```

## 3. 各レイヤーの責務
- Router
  - HTTP 入力バリデーション、認証・認可チェック、レスポンス整形。
- Service
  - 出勤・退勤判定、勤怠修正ルール、本人所有レコードの検証、シフト照合、変更履歴の記録などの業務ロジック。
- Repository
  - データ永続化、トランザクションを伴うデータアクセス、勤怠変更履歴の追記保存。
- Calendar Adapter
  - iCal フィードの取得・パース境界。
- Mail Adapter
  - Gmail API（OAuth 2.0 クライアント認証）を用いた確認メール送信および月次の勤怠実績レポートの自動配信メール送信を行う連携境界。
- Logger
  - Python `logging` モジュール + `RotatingFileHandler` で `logs/kint.log` に JSON Lines 形式で出力する。
  - `GET /api/v1/logs` エンドポイント（管理者専用）でフロントエンドから参照可能。
- Frontend(WebUSB)
  - WebUSB 経由で PaSoRi から IDm を取得し、API に打刻要求を送信する。
  - WebUSB 非対応環境では user_id 入力による代替打刻導線を提供する。

## 4. 打刻シーケンス

```mermaid
sequenceDiagram
  participant Emp as 従業員
  participant Brw as Browser(Punch UI)
  participant USB as WebUSB-FeliCa
  participant Rt as API Router
  participant Sv as Attendance Service
  participant Rp as Repository
  participant Db as SQLite
  participant Cal as Calendar Adapter

  Emp->>Brw: 打刻画面を開く
  Brw->>USB: PaSoRi に接続して IDm 読み取り
  Emp->>Brw: カード忘れ時は user_id を入力
  Brw->>Rt: POST /api/v1/punches
  Rt->>Sv: バリデーションして委譲
  Sv->>Rp: card_idm または user_id から利用者を特定
  Rp->>Db: SELECT card and user / SELECT user
  Db-->>Rp: user
  Sv->>Rp: 当日の勤怠を取得
  Rp->>Db: SELECT attendance by date
  Db-->>Rp: attendance
  Sv->>Sv: 出勤・退勤を判定
  Sv->>Rp: INSERT または UPDATE attendance
  Rp->>Db: 永続化
  Sv->>Cal: シフト照合（非同期許容）
  Sv-->>Rt: 打刻結果
  Rt-->>Brw: 200 OK

### 4-2. 打刻端末制限と登録シーケンス

```mermaid
sequenceDiagram
  participant Emp as 従業員/管理者
  participant Brw as Browser (打刻端末)
  participant API as FastAPI Backend

  alt 初回/未登録
    Emp->>Brw: 打刻ページを開く
    Brw->>Brw: LocalStorage にデバイストークンが無いことを確認
    Brw-->>Emp: 「未登録の端末です」エラーと管理者ログインボタンを表示
    Emp->>Brw: 管理者アカウントでログイン
    Brw->>API: POST /api/v1/auth/google (管理者認証)
    API-->>Brw: 認証成功 (管理者JWTトークン)
    Emp->>Brw: 端末名を入力して「この端末を登録」をクリック
    Brw->>API: POST /api/v1/punch-devices/token (name)
    API-->>Brw: デバイストークン (署名付きJWT)
    Brw->>Brw: LocalStorage にデバイストークンを保存
    Brw-->>Emp: 打刻待ち受け画面を表示
  else 登録済み
    Emp->>Brw: 打刻ページを開く
    Brw->>Brw: LocalStorage からデバイストークンを取得
    Brw->>API: GET /api/v1/punch-devices/verify (X-Punch-Device-Token)
    Note over API: DBを使わずにトークンの署名を検証
    API-->>Brw: { "valid": true, "name": "端末名" }
    Brw-->>Emp: 打刻待ち受け画面を表示
  end
```
```

## 5. 概念 ER 図

```mermaid
erDiagram
  USER ||--o{ CARD : 所有
  USER ||--o{ ATTENDANCE : 記録
  USER ||--o{ SHIFT : 保有
  USER ||--o{ ATTENDANCE_CHANGE_LOG : 実行
  CARD ||--o{ ATTENDANCE : 利用
  SHIFT ||--o{ ATTENDANCE : 照合
  ATTENDANCE ||--o{ ATTENDANCE_CHANGE_LOG : 変更履歴
```

## 6. 勤怠修正ポリシー
- 利用者は自分自身の勤怠記録のみ修正できる。
- 管理者は全利用者の勤怠記録を修正できる。
- 修正時は必ず reason を指定する。
- 修正のたびに、変更前値、変更後値、実行者、実行日時、修正理由を履歴として追記保存する。
- 履歴は上書きせず、監査証跡として不変のログとして扱う。
- 管理者および一般従業員は、Web上の日別勤怠詳細カレンダーの「操作」列から、各勤怠データの変更履歴（不変の監査ログ）をモーダルで直接閲覧できる。

## 7. マイページ（本人プロフィール編集）
- ログイン済みユーザーはマイページで name, full_name, password を更新できる。
- ログイン済みユーザーは email 変更要求を作成できるが、email 自体は承認リンク確認後に更新する。
- Router は本人コンテキストのみを Service に渡し、他ユーザーID指定を受け付けない。
- Service は email 重複チェック、確認トークン発行、Gmail API 送信、パスワード強度検証、current_password 検証を実施する。
- Repository は users テーブル更新、verification request 記録、監査ログ記録をトランザクションで実行する。
- email 変更確定時または password 更新時は認証セッションを無効化し、再ログインを強制する。

```mermaid
sequenceDiagram
  participant U as User
  participant UI as My Page UI
  participant Rt as User Router
  participant Sv as User Service
  participant Rp as User Repository
  participant Db as SQLite
  participant Gm as Gmail API
  participant Au as Auth Session

  U->>UI: 新メールアドレスを入力
  UI->>Rt: POST /api/v1/me/email-change-requests
  Rt->>Sv: 本人コンテキストで委譲
  Sv->>Rp: email 重複確認 + token 保存
  Rp->>Db: SELECT users / INSERT email_verification_requests
  Db-->>Rp: 結果
  Sv->>Gm: 確認メール送信
  Gm-->>Sv: 送信結果
  Rt-->>UI: 202 pending_confirmation

  U->>UI: メール内リンクを開く
  UI->>Rt: POST /api/v1/email-verifications/confirm
  Rt->>Sv: token を委譲
  Sv->>Rp: token 検証 + users 更新
  Rp->>Db: UPDATE users + UPDATE email_verification_requests
  Sv->>Au: email_change 完了時にセッション無効化
  Rt-->>UI: 200 confirmed または 400 invalid_token
```

## 8. ユーザー管理ポリシー
- 管理者はユーザーを登録/修正/削除できる。
- ユーザー削除は論理削除（`is_active=false`）で実施し、勤怠・監査データは保持する。
- 一般利用者はユーザー管理 API を実行できない。

## 9. アーキテクチャ決定事項
- ADR-001: 現段階ではモジュラモノリスを採用する。
  - 根拠: 開発速度を確保しつつ、運用複雑性を抑えられるため。
- ADR-002: 打刻 UI と管理 UI は同一 Web アプリ内で機能分離する。
  - 根拠: 運用導線を統一しつつ、権限と画面責務を明確化するため。
- ADR-003: 打刻 API は冪等キーをサポートする。
  - 根拠: 再送時の二重打刻を防ぐため。
- ADR-004: 勤怠修正では修正理由を必須にする。
  - 根拠: 監査証跡を確保するため。
- ADR-005: 利用者本人による勤怠修正を許可し、全変更履歴を不変ログとして保持する。
  - 根拠: 現場運用の柔軟性を確保しつつ、変更の追跡可能性を失わないため。
- ADR-006: カード忘れ時は user_id による打刻を許可する。
  - 根拠: 打刻機会損失を防ぎつつ、打刻元 `source` と監査ログでトレーサビリティを維持するため。
- ADR-007: NFC 読み取りは WebUSB を使ってブラウザで実行する。
  - 根拠: 専用デスクトップアプリを廃止し、配布・更新コストを削減するため。
- ADR-008: ユーザー削除は論理削除で運用する。
  - 根拠: 勤怠・監査履歴の参照整合性を維持するため。

- ADR-009: 本人プロフィール編集は管理者向けユーザー管理 API と分離する。
  - 根拠: 権限境界を明確化し、本人編集で role/is_active が変更される事故を防ぐため。

- ADR-010: メールアドレス登録・変更は即時反映せず、Gmail API で送信する確認メール承認後に確定する。
  - 根拠: 実在性確認と誤入力防止を両立し、なりすましや配送不能アドレス登録を減らすため。

- ADR-011: Gmail API 送信は OAuth クライアント（OAuth 2.0）を採用する。
  - 根拠: Google の標準的な認可方式に準拠し、トークンの失効・再認可を運用しやすくするため。

- ADR-013: バックエンドログは JSON Lines 形式で `logs/kint.log` にファイル保存し、管理者向け Web UI から参照可能にする。
  - 根拠: uvicorn の stdout だけでは運用中のログを遡れないため、ファイルに永続化する。JSON Lines にすることで API 側でのパースを単純化し、ローテーションで無制限の肥大化を防ぐ。
  - ログレベルは `DEBUG=true` 環境変数で切り替え可能。本番デフォルトは `INFO`。
  - `GET /api/v1/logs` (管理者専用) で `level` / `keyword` / `limit` によるフィルタリングが可能。

- ADR-014: 勤怠集計（サマライズ）および日別突き合わせ処理は、メモリ上で一括マージ（In-memory Map-Reduce）処理を行う。
  - 根拠: 1か月単位の範囲データは、ユーザー数・日付数が限定的（例: 従業員100人 × 31日 ＝ 3,100レコード）であり、データベースで複雑な多重アウタージョインを書くよりも、SQLite への Bulk Query 後の Python メモリ上でのマージのほうがシンプルであり、かつパフォーマンスや拡張性に優れ（N+1問題の完全な排除）、コードの可読性を格段に高められるため。

- ADR-015: 勤怠データのエクスポート（ローカル保存）における文字エンコーディングとして、BOM付き UTF-8 を指定する.
  - 根拠: 日本国内の業務フローにおいて、エクスポートされた CSV ファイルを Microsoft Excel 等の表計算ソフトで直接開くユースケースが圧倒的に多く、それによる日本語を含む文字化けの発生を完全に防止して高いユーザビリティを提供するため。

- ADR-016: 打刻端末の制限にはデータベース（サーバー側保存）を使わず、管理者が署名したデバイストークン（JWT）をブラウザの LocalStorage に保存する方式を採用する。
  - 根拠: サーバー側でのデバイス一覧管理やデータベーススキーマ変更などの運用複雑性を排除しつつ、暗号的な検証のみで打刻ページのアクセス制御（端末制限）と打刻機能の安全な提供を行えるため。また、登録解除も端末上の LocalStorage 削除のみで完結し非常にシンプルである。

- ADR-017: 勤務時間の5分丸め処理と労働時間算出基準
  - 根拠: つくまなラボの給与計算ルールに基づき、シフト情報と突き合わせて出勤・退勤時刻を5分単位で丸めた「勤務出勤」「勤務退勤」を計算する。実労働時間（`working_hours`、画面表示上は「勤務時間」）の算出についても、この丸められた時間を基準とすることで、システムで集計される勤務データをそのまま給与計算に直結可能にするため。

- ADR-018: 打刻取り消し直後の誤打刻防止のためのメモリキャッシュによる打刻時間保持
  - 根拠: 5分以内の打刻取り消しによって出退勤レコードがデータベースから物理削除された場合でも、その直後に従業員が再度意図せずカードをかざして即時出勤扱いになってしまう間違いを防ぐため、バックエンドのメモリ上に直近の打刻完了・取り消し時刻をユーザー毎にキャッシュして連続打刻防止クールダウン（`punch_cooldown_seconds`）を適用する。

- ADR-019: 打刻結果メッセージの表示時間可変化と割り込み打刻の許容
  - 根拠: 利用者ごとに最適な表示時間（1〜300秒、デフォルト30秒）を設定可能にすることで運用上の柔軟性を向上させつつ、打刻画面でメッセージが表示中であっても、次の打刻が開始されたら即時に既存表示をクリアして新たな打刻の処理に移る（割り込み可能な）UXを提供することで、連続打刻の滞りを防ぐため。

- ADR-020: 月次勤怠レポートの自動メール通知機能とスケジューラーのリスケジュール制御
  - 根拠: 毎月末日の指定された設定時刻に自動で月次の勤怠実績（勤務日数、勤務時間、4月からの総勤務時間）を従業員（管理者除外、メールアドレスが設定されているアクティブユーザー）へメールで通知する。管理者による自動通知時刻（`monthly_report_time`）の変更が即時に反映されるように、APScheduler による動的な再スケジュールを行う。これにより、サーバー再起動を行うことなく運用スケジュールの柔軟な変更が可能となる。

## 10. 本番デプロイ構成

### 10-1. サーバー構成

```
[Linux サーバー]
┌────────────────────────────────────────────────────────┐
│                                                        │
│  外部リクエスト (Port 80/443)                           │
│        │                                               │
│        ▼                                               │
│  ┌───────────┐  SPA静的配信 (GET /)                     │
│  │   Nginx   │───────────────────────────────┐         │
│  └─────┬─────┘                               ▼         │
│        │ リバースプロキシ                   ┌─────────┐│
│        │ (POST / , /api/* , /docs*)         │React SPA││
│        ▼                                    └─────────┘│
│  ┌───────────┐                                         │
│  │  FastAPI  │ (PM2で起動、Port 8000)                  │
│  │ (uvicorn) │                                         │
│  └─────┬─────┘                                         │
│        ▼                                               │
│   SQLite (kint.db)                                     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- **フロントエンドとバックエンドの分離配信**: Nginx が React SPA のビルド成果物 (`frontend/dist`) を直接配信し、API や認証用の POST リクエストを PM2 で管理された FastAPI サーバーに転送します。
- **PM2 によるバックエンド管理**: FastAPI サーバーは PM2 の管理下でデーモンとして稼働し、自動再起動やリソース監視が行われます。
- **SQLite 永続化**: データはローカルの `kint.db` に直接保存され、ファイルベースで永続化されます。

### 10-2. ビルド・デプロイフロー

```
[ビルド環境]
  1. frontend/ で依存関係をインストールし、本番ビルドを実行:
     npm ci && npm run build  --> dist/ ディレクトリが生成される
  2. 生成された dist/ を Nginx の公開ディレクトリ (例: /var/www/kint/frontend/dist) に配置

[バックエンド環境]
  1. Python の依存関係をインストール:
     uv sync --frozen --no-dev
  2. データベースマイグレーションの実行:
     uv run alembic upgrade head
  3. PM2 による起動:
     pm2 start ecosystem.config.js
```

### 10-3. Google OAuth2 本番フロー

```
ブラウザ
  → Google ログイン (redirect モード)
  → Google が POST / に credential を form_post
  → Nginx が POST / リクエストを検知し、FastAPI バックエンドに proxy_pass する
  → FastAPI POST / が credential を sessionStorage にセットして GET / にリダイレクトするHTMLを返す
  → ブラウザで GET / が走り、Nginx が React SPA (index.html) を返す
  → React useEffect が sessionStorage から credential を取得
  → POST /api/v1/auth/google で バックエンドから JWT を発行
  → ログイン完了
```

### 10-4. ADR-012: 本番では Nginx が SPA を直接配信し、FastAPI へのリバースプロキシを担う
- **根拠**: FastAPI 単体で静的ファイルをサーブするよりも、Nginx をフロントエンド配信の専門サーバーとして利用する方がパフォーマンス、キャッシュ制御、セキュリティの面で優れているため。また、`POST /` に対する柔軟なハンドリングも Nginx のレイヤーで安全に制御できます。
- **制約**: Nginx 側で、`/` 宛の `POST` リクエスト（OAuth コールバック）を確実に FastAPI バックエンドにプロキシし、それ以外の `GET` 等のリクエストは SPA のフォールバック (`try_files ... /index.html`) に流す必要があります。

---

## 11. トレードオフ整理
- 現時点の推奨構成はモジュラモノリス。
- 将来的に外部 API 負荷が増えた場合は、Calendar 同期を別ワーカーサービスへ分離する。
- WebUSB は HTTPS と対応ブラウザが前提となるため、クライアント環境要件の明確化が必要になる。
- 論理削除によりデータ保持量は増えるため、定期的なアーカイブ運用を検討する。

## 12. 対応ブラウザ要件（確定）

### 12-1. サポート方針
- 公式サポート（本番運用対象）:
  - Windows 11 + Google Chrome 最新安定版
  - Windows 11 + Microsoft Edge 最新安定版
- 準サポート（検証環境での動作確認対象）:
  - Windows 10 + Google Chrome / Microsoft Edge 最新安定版
- 非サポート:
  - Firefox（WebUSB 非対応）
  - Safari（WebUSB 非対応）
  - モバイルブラウザ（USB 接続運用が前提外）

### 12-2. ブラウザ機能要件
- `navigator.usb` が利用可能であること。
- 打刻ページは HTTPS で配信されること（開発時は `localhost` を許容）。
- USB デバイス選択はユーザー操作（クリック）起点で実行すること。

## 12. 運用要件（確定）

### 12-1. 現場運用要件
- 打刻端末は USB ポートを持つ Windows PC を使用すること。
- PaSoRi は 1 ブラウザインスタンスのみが利用する（同時占有を禁止）。
- 打刻画面に「接続状態（未接続/接続中/読取成功/エラー）」を常時表示する。
- WebUSB 接続失敗時は `user_id + reason` 入力による代替打刻へ遷移できる。

### 12-2. セキュリティ要件
- 打刻用 URL は社内配布 URL のみに限定する。
- 登録された有効なデバイストークン（JWT）を保持するブラウザ（端末）のみが未ログイン用の打刻ページを開けるように制限する。
- ブラウザのデバイス権限は運用手順に従って管理し、不要時は解除する。
- 打刻 API は既存認証・監査ログ要件を維持する。

### 12-3. 障害時運用要件
- WebUSB 非対応ブラウザを検出した場合は即時にサポート外メッセージを表示する。
- PaSoRi 接続不可時は再接続手順（抜き差し、ブラウザ再起動）をガイド表示する。
- 復旧不能時は代替打刻（user_id）導線へ遷移し、理由入力を必須にする。

## 13. 実装計画
- 実装チケット、依存関係、スケジュール、起票用バックログは [docs/implementation-plan.md](docs/implementation-plan.md) を参照。
