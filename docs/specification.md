# Kint 統合仕様書

## 1. 文書目的
本書は、Kint の業務仕様・システム仕様・API仕様・データ仕様を統合し、
実装担当、レビュー担当、運用担当が同じ前提で作業できるようにするための基準文書である。

## 2. 対象範囲
- 対象システム: NFC 勤怠管理システム Kint
- 対象機能:
  - Web アプリでの打刻（WebUSB + PaSoRi）
  - カード忘れ時の user_id フォールバック打刻
  - 勤怠一覧・勤怠修正・変更履歴表示
  - Google Calendar シフト連携
- 対象外:
  - 旧 Desktop 打刻アプリの新規機能追加

## 3. システム構成
- Server: FastAPI + SQLite
- Client: React SPA (打刻 UI + 管理 UI)
- NFC: WebUSB を通じて PaSoRi (RC-S380/RC-S300) を利用

参照:
- アーキテクチャ: docs/architecture.md
- API 契約: docs/api-contract.openapi.yaml
- DB 設計: docs/database-design.md
- 実装計画: docs/implementation-plan.md

## 4. 利用者と権限
- 従業員:
  - 自分の打刻実行
  - 自分の勤怠修正
  - 自分の勤怠変更履歴閲覧
- 管理者:
  - ユーザーの登録・修正・削除
  - 全従業員の勤怠参照・修正
  - カード登録
  - シフト同期実行
  - 全従業員の変更履歴閲覧

## 5. 機能仕様

### 5-1. 打刻機能
- 通常打刻:
  - WebUSB で PaSoRi を接続し、カードの IDm を取得して打刻する。
- フォールバック打刻:
  - カード忘れ・読取不能時は user_id + reason で打刻する。
- 打刻判定:
  - 当日レコード未作成なら check_in。
  - 当日 check_in のみ存在なら check_out。
  - 不正遷移は 409 を返す。

### 5-2. カード登録機能
- Web アプリから card_idm を user_id に紐付ける。
- 同一 card_idm の複数ユーザー共有は禁止。
- 1ユーザー複数カードは許可。

### 5-3. 勤怠修正機能
- 修正時は reason 必須。
- 本人は自分の勤怠のみ修正可能。
- 管理者は全勤怠を修正可能。

### 5-4. 変更履歴機能
- 勤怠修正時は必ず変更履歴を追記保存する。
- 履歴は不変ログとして扱い、更新・削除しない。
- 履歴には before/after、reason、actor、changed_at を含む。

### 5-5. シフト連携
- Google Calendar API からシフトを取得し DB に保存。
- 同期 API は非同期受理 (202) とする。

### 5-6. ユーザー管理機能（管理者専用）
- ユーザー登録:
  - 管理者はユーザーを新規作成できる。
- ユーザー修正:
  - 管理者はユーザーの氏名、表示名、メールアドレス、ロール、有効状態を更新できる。
- ユーザー削除:
  - 監査整合性のため論理削除（`is_active=false`）とする。
  - 既存の勤怠・履歴データは保持する。

## 6. API 仕様要点

### 6-1. 主要エンドポイント
- POST /api/v1/users
- PATCH /api/v1/users/{user_id}
- DELETE /api/v1/users/{user_id}
- POST /api/v1/punches
- POST /api/v1/cards/registrations
- GET /api/v1/attendance
- PATCH /api/v1/attendance/{attendance_id}
- GET /api/v1/attendance/{attendance_id}/history
- POST /api/v1/shifts/sync

### 6-2. 打刻リクエスト
- oneOf 条件:
  - card_idm + device_id + occurred_at
  - user_id + reason + device_id + occurred_at

### 6-3. エラー仕様
- 401: 認証失敗
- 403: 権限不足
- 404: カード未登録 / ユーザー未登録 / 対象なし
- 409: 二重打刻または不正遷移
- 422: リクエストバリデーションエラー
- 共通レスポンス形式: code / message / detail

### 6-4. ユーザー管理 API バリデーション仕様
- 共通ルール:
  - email は RFC 準拠フォーマットかつ一意であること。
  - name は 1〜50 文字、full_name は 1〜100 文字。
  - role は admin / employee のみ。
  - 文字列項目は前後空白を除去して評価する。
- POST /api/v1/users:
  - 必須: name, full_name, email, role, password。
  - password は 8〜72 文字、英字と数字を各1文字以上含む。
  - 既存メール重複は 409 を返す。
  - 入力違反は 422 を返す。
- PATCH /api/v1/users/{user_id}:
  - 更新対象フィールドが 1 つ以上必要（空 body は 422）。
  - email 更新時は重複チェックを行い、重複は 409。
  - role 更新時は admin / employee 以外を拒否（422）。
  - is_active=false へ更新する場合、最後の有効な admin を無効化してはならない（409）。
- DELETE /api/v1/users/{user_id}:
  - 論理削除（is_active=false）として扱う。
  - 既に is_active=false のユーザーに対する削除は冪等に 204 を返す。
  - 最後の有効な admin の削除要求は 409 を返す。

詳細は docs/api-contract.openapi.yaml を正とする。

## 7. データ仕様要点

### 7-1. 打刻ソース
attendances.source は以下のみ許容:
- webusb_nfc
- web_user_id
- admin_manual
- self_service

### 7-2. カード制約
- cards.card_idm は UNIQUE
- cards.user_id は UNIQUE ではない（複数カード許可）

### 7-3. 監査制約
- attendance_change_logs は INSERT のみ
- 勤怠更新と履歴追記は同一トランザクションで実行

詳細は docs/database-design.md を正とする。

## 8. 非機能仕様

### 8-1. 対応環境
- 公式サポート:
  - Windows 11 + Chrome 最新安定版
  - Windows 11 + Edge 最新安定版
- 準サポート:
  - Windows 10 + Chrome/Edge 最新安定版
- 非サポート:
  - Firefox
  - Safari
  - モバイルブラウザ

### 8-2. 通信要件
- 本番は HTTPS 必須
- WebUSB はユーザー操作起点でデバイス接続する

### 8-3. セキュリティ要件
- 打刻 URL は社内配布 URL のみ
- API は認証・認可を適用
- 修正操作は全て監査ログ記録

## 9. 障害時仕様
- WebUSB 非対応環境検出時:
  - サポート外メッセージを表示し user_id 打刻へ誘導
- PaSoRi 接続失敗時:
  - 再接続ガイドを表示
  - 代替打刻（user_id + reason）を許可

## 10. 受け入れ条件（システム）
- 管理者がユーザーを登録/修正/削除（論理削除）できる。
- WebUSB で IDm を取得して打刻できる。
- user_id + reason で代替打刻できる。
- source が webusb_nfc / web_user_id で正しく保存される。
- 勤怠修正時に履歴が欠落なく追加される。
- 管理画面で source と履歴が確認できる。
- API と DB が契約文書と整合する。

## 11. 変更管理
- 本仕様を更新する場合は、以下 4 文書を同時レビューする。
  - docs/architecture.md
  - docs/api-contract.openapi.yaml
  - docs/database-design.md
  - docs/implementation-plan.md
