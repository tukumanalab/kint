# Kint アーキテクチャ設計

## 1. 目的
Kint は、正確性、監査性、運用容易性を重視した NFC 勤怠管理システムです。
アーキテクチャは Router -> Service -> Repository を採用し、Desktop の打刻機能と Web の管理機能を分離します。
また、利用者自身による打刻修正を許可し、その際は修正理由を必須とし、変更前後の内容と実行者情報をすべて履歴として記録します。

## 2. システム構成

```mermaid
flowchart LR
  subgraph Desktop[Windows デスクトップアプリ]
    NFC[PaSoRi リーダー]
    PunchUI[打刻・登録 UI]
  end

  subgraph Server[Linux サーバー]
    API[FastAPI]
    Router[Router 層]
    Service[Service 層]
    Repo[Repository 層]
    DB[(SQLite)]
    Calendar[Google Calendar アダプター]
    Auth[認証 Session/JWT]
    Audit[監査ログ]
  end

  subgraph Web[React SPA]
    AdminUI[管理コンソール]
  end

  NFC --> PunchUI
  PunchUI -->|HTTPS| API
  AdminUI -->|HTTPS| API

  API --> Router --> Service --> Repo --> DB
  Service --> Calendar
  API --> Auth
  Service --> Audit
```

## 3. 各レイヤーの責務
- Router
  - HTTP 入力バリデーション、認証・認可チェック、レスポンス整形。
- Service
  - 出勤・退勤判定、勤怠修正ルール、本人所有レコードの検証、シフト照合、変更履歴の記録などの業務ロジック。
- Repository
  - データ永続化、トランザクションを伴うデータアクセス、勤怠変更履歴の追記保存。
- Calendar Adapter
  - Google Calendar API との連携境界。

## 4. 打刻シーケンス

```mermaid
sequenceDiagram
  participant Emp as 従業員
  participant Desk as Desktop App
  participant Rt as API Router
  participant Sv as Attendance Service
  participant Rp as Repository
  participant Db as SQLite
  participant Cal as Calendar Adapter

  Emp->>Desk: NFCカードをタッチ（カード忘れ時は user_id 入力）
  Desk->>Rt: POST /api/v1/punches
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
  Rt-->>Desk: 200 OK
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

## 7. アーキテクチャ決定事項
- ADR-001: 現段階ではモジュラモノリスを採用する。
  - 根拠: 開発速度を確保しつつ、運用複雑性を抑えられるため。
- ADR-002: Desktop API と Web API を論理的に分離する。
  - 根拠: セキュリティ境界と責務分離を明確にするため。
- ADR-003: 打刻 API は冪等キーをサポートする。
  - 根拠: 再送時の二重打刻を防ぐため。
- ADR-004: 勤怠修正では修正理由を必須にする。
  - 根拠: 監査証跡を確保するため。
- ADR-005: 利用者本人による勤怠修正を許可し、全変更履歴を不変ログとして保持する。
  - 根拠: 現場運用の柔軟性を確保しつつ、変更の追跡可能性を失わないため。
- ADR-006: カード忘れ時は user_id による打刻を許可する。
  - 根拠: 打刻機会損失を防ぎつつ、打刻元 `source` と監査ログでトレーサビリティを維持するため。

## 8. トレードオフ整理
- 現時点の推奨構成はモジュラモノリス。
- 将来的に外部 API 負荷が増えた場合は、Calendar 同期を別ワーカーサービスへ分離する。

## 9. 実装チケット分解（@backend 向け）

### BE-01: 打刻 API 入力拡張（NFC / user_id 両対応）
- 目的:
  - POST /punches で card_idm と user_id のどちらでも打刻可能にする。
- 実装範囲:
  - Router の入力スキーマを oneOf 条件に合わせる。
  - user_id 打刻時は reason 必須バリデーションを追加する。
- 受け入れ条件:
  - card_idm 指定で打刻できる。
  - user_id + reason 指定で打刻できる。
  - user_id で reason 未指定の場合は 422 を返す。

### BE-02: 利用者解決ロジック実装
- 目的:
  - Service 層で card_idm / user_id の解決分岐を行う。
- 実装範囲:
  - get_user_by_card_idm と get_user_by_user_id を Repository に実装。
  - 共通の勤怠判定ロジック（check_in / check_out）に統合。
- 受け入れ条件:
  - どちらの入力方式でも同じ判定ロジックを通る。
  - 未登録 card_idm、未登録 user_id は 404 を返す。

### BE-03: 打刻ソース保存とレスポンス拡張
- 目的:
  - 打刻方法の追跡性を担保する。
- 実装範囲:
  - attendances.source に desktop_nfc / desktop_user_id を保存。
  - PunchResponse に method（card_idm / user_id）を追加する。
- 受け入れ条件:
  - NFC 打刻で source=desktop_nfc, method=card_idm が返る。
  - user_id 打刻で source=desktop_user_id, method=user_id が返る。

### BE-04: 監査ログ連携
- 目的:
  - user_id 打刻時の理由と実行者情報を監査可能にする。
- 実装範囲:
  - 打刻更新時に attendance_change_logs へ before/after/reason/actor を保存。
  - attendances.updated_reason と最終更新者情報を同期。
- 受け入れ条件:
  - user_id 打刻時に履歴が必ず 1 件以上追加される。
  - 履歴 INSERT と本体 UPDATE が同一トランザクションで処理される。

### BE-05: エラーレスポンス統一
- 目的:
  - API 契約どおりのエラー形式を保証する。
- 実装範囲:
  - 404（カード未登録またはユーザー未登録）、409（競合）を統一。
  - code / message / detail 形式に揃える。
- 受け入れ条件:
  - 失敗時レスポンスがすべて ErrorResponse 契約を満たす。

### BE-06: テスト追加（pytest）
- 目的:
  - 仕様追加による回帰を防止する。
- 実装範囲:
  - 正常系: card_idm 打刻、user_id + reason 打刻。
  - 異常系: reason 欠落、対象不在、二重打刻。
  - 監査系: user_id 打刻で履歴追記と source 保存を検証。
- 受け入れ条件:
  - 追加ケースが自動テストで再現・検証される。

### BE-07: リリース前整合確認
- 目的:
  - API 契約・DB 設計とのズレを排除する。
- 実装範囲:
  - docs/api-contract.openapi.yaml と docs/database-design.md を基準に差分レビュー。
  - Desktop クライアント向け仕様（入力とエラーコード）を確認。
- 受け入れ条件:
  - API 実装が契約と整合し、フロント/デスクトップ連携のブロッカーがない。

## 10. 実装チケット分解（@database 向け）

### DB-01: `users` への `full_name` 追加
- 目的:
  - 本名データを保持できるようにする。
- 実装範囲:
  - SQLAlchemy モデルへ `full_name`（NOT NULL）を追加。
  - 既存データがある場合は段階的 migration（暫定値投入後に NOT NULL 化）を検討。
- 受け入れ条件:
  - `users.full_name` が必須項目として保存・取得できる。

### DB-02: `attendances.source` 列挙値拡張
- 目的:
  - カード忘れ打刻を区別して保存する。
- 実装範囲:
  - CHECK 制約へ `desktop_user_id` を追加。
  - 既存行の整合性を確認し、制約更新時の失敗を防ぐ。
- 受け入れ条件:
  - `desktop_nfc` / `desktop_user_id` / `admin_manual` / `self_service` のみ保存可能。

### DB-03: 変更履歴テーブル運用保証
- 目的:
  - 勤怠変更の監査証跡を完全に残す。
- 実装範囲:
  - `attendance_change_logs` のモデル定義と FK/INDEX を実装。
  - アプリ層から UPDATE/DELETE を行わない運用を徹底。
- 受け入れ条件:
  - 勤怠修正時に履歴が追記され、履歴の欠落が発生しない。

### DB-04: Alembic マイグレーション作成（SQLite 対応）
- 目的:
  - 追加/変更したスキーマを安全に適用する。
- 実装範囲:
  - `upgrade()` / `downgrade()` を両実装。
  - SQLite の制約を考慮し `render_as_batch=True` 前提で migration を記述。
  - `alembic downgrade -1` / `upgrade head` の往復検証。
- 受け入れ条件:
  - 新規環境と既存環境の両方で migration が成功する。

## 11. 実装チケット分解（@nfc 向け）

### NFC-01: 打刻 UI 拡張（カード忘れ対応）
- 目的:
  - カード忘れ時に user_id 打刻へフォールバックできるようにする。
- 実装範囲:
  - 打刻画面に `user_id` 入力欄と `reason` 入力欄を追加。
  - 通常時は NFC 読み取り導線を優先表示。
- 受け入れ条件:
  - NFC が使えない状況でも user_id 打刻が実行できる。

### NFC-02: API クライアント送信形式更新
- 目的:
  - API 契約（oneOf）に沿って打刻リクエストを送信する。
- 実装範囲:
  - 通常: `card_idm + device_id + occurred_at`
  - カード忘れ: `user_id + reason + device_id + occurred_at`
  - `Idempotency-Key` の再送制御を維持。
- 受け入れ条件:
  - 2 方式の送信がともに成功し、レスポンス `method` を正しく処理できる。

### NFC-03: エラー表示と操作ガード
- 目的:
  - 現場運用での入力ミスと誤解を減らす。
- 実装範囲:
  - reason 未入力時の送信抑止。
  - 404/409 応答時のメッセージ出し分け。
- 受け入れ条件:
  - 操作ミス時に UI 上で修正手順を案内できる。

### NFC-04: デスクトップテスト更新
- 目的:
  - 新仕様の回帰を防止する。
- 実装範囲:
  - API クライアント単体テストに user_id 打刻ケースを追加。
  - UI テストまたはイベントハンドラテストで必須入力を検証。
- 受け入れ条件:
  - user_id 打刻経路の主要ケースが自動テストで担保される。

## 12. 依存関係と着手順

### 12-1. 依存マトリクス
- BE-01 は DB-02 完了前でも実装開始可能（ただし結合試験は DB-02 後）。
- BE-03 は DB-03 と同時進行可能だが、最終確認は DB-04 後。
- NFC-02 は BE-01 と API 契約確定後に実装開始。
- NFC-03 は BE-05 のエラーコード確定後に文言最終化。

### 12-2. 推奨スケジュール（2 スプリント）

```mermaid
gantt
  title カード忘れ打刻対応の実装計画
  dateFormat  YYYY-MM-DD

  section Sprint 1
  DB-01 users.full_name 追加           :a1, 2026-04-06, 2d
  DB-02 attendances.source 拡張        :a2, after a1, 1d
  DB-03 変更履歴テーブル運用保証       :a3, after a2, 2d
  BE-01 打刻 API 入力拡張              :b1, 2026-04-06, 3d
  BE-02 利用者解決ロジック             :b2, after b1, 2d
  BE-03 source/method 反映             :b3, after b2, 1d

  section Sprint 2
  DB-04 Alembic migration 検証         :a4, 2026-04-14, 2d
  BE-04 監査ログ連携                   :b4, after a4, 2d
  BE-05 エラーレスポンス統一           :b5, after b4, 1d
  NFC-01 打刻 UI 拡張                  :c1, 2026-04-14, 2d
  NFC-02 API クライアント更新          :c2, after c1, 2d
  NFC-03 エラー表示と操作ガード        :c3, after b5, 1d
  BE-06/NFC-04 テスト                  :t1, after c3, 2d
  BE-07 リリース前整合確認             :r1, after t1, 1d
```

## 13. 実装チケット分解（@frontend 向け）

### FE-01: 型定義と API クライアント更新
- 目的:
  - 追加された打刻契約に追従し、型安全に UI 実装できる状態を作る。
- 実装範囲:
  - `UserProfile.full_name` の型を反映。
  - `PunchRequest` の oneOf 条件（card_idm または user_id+reason）を型で表現。
  - `PunchResponse.method` と `AttendanceRecord.source=desktop_user_id` を反映。
- 受け入れ条件:
  - 型チェックで契約差分エラーが発生しない。

### FE-02: 管理画面の勤怠表示更新
- 目的:
  - 打刻方法の識別情報を管理画面で確認可能にする。
- 実装範囲:
  - 勤怠一覧に打刻元 `source` を表示。
  - `desktop_user_id` の場合は「カード忘れ（user_id）」とラベル表示。
- 受け入れ条件:
  - 管理者がカード打刻と user_id 打刻を画面上で判別できる。

### FE-03: 変更履歴画面の拡張
- 目的:
  - 監査要件として変更履歴を確認できるようにする。
- 実装範囲:
  - `/attendance/{attendance_id}/history` の取得 UI を追加。
  - 変更前/変更後/理由/実行者/実行日時を表示。
- 受け入れ条件:
  - 対象勤怠に対して時系列の変更履歴を閲覧できる。

### FE-04: フロントエンドテスト更新
- 目的:
  - 契約変更に伴う表示回帰を防止する。
- 実装範囲:
  - `full_name` 表示テストを追加。
  - `source` 表示ラベル変換テストを追加。
  - 変更履歴表示コンポーネントのレンダリングテストを追加。
- 受け入れ条件:
  - 主要 UI ケースが自動テストで担保される。

## 14. 依存関係の更新（Frontend 追加分）

### 14-1. 依存マトリクス追加
- FE-01 は BE-01 と API 契約確定後に着手可能。
- FE-02 は BE-03（source 保存）完了後に結合確認。
- FE-03 は BE-04（履歴保存）と `/attendance/{attendance_id}/history` 実装完了後に結合確認。
- FE-04 は FE-01〜03 の完了後に実施。

### 14-2. 統合受け入れ条件（全チーム）
- 通常打刻: NFC で打刻でき、`source=desktop_nfc` で保存される。
- カード忘れ打刻: user_id + reason で打刻でき、`source=desktop_user_id` で保存される。
- 修正監査: 勤怠修正時に履歴が欠落なく追記される。
- 表示整合: 管理画面で `full_name`、打刻元、変更履歴が正しく表示される。
- 契約整合: API 実装、Desktop、Frontend が `docs/api-contract.openapi.yaml` と一致する。

## 15. 起票用バックログ（このまま Issue 化可能）

### P0-1: DB マイグレーション実装（full_name と source 拡張）
- 担当: @database
- 依存: なし
- 完了条件:
  - `users.full_name` が追加される。
  - `attendances.source` に `desktop_user_id` が追加される。
  - upgrade/downgrade の往復が成功する。

### P0-2: 打刻 API 拡張（card_idm / user_id oneOf）
- 担当: @backend
- 依存: P0-1
- 完了条件:
  - POST `/punches` が `card_idm` と `user_id+reason` の双方を受理する。
  - reason 欠落時は 422 を返す。
  - 未登録 card_idm/user_id で 404 を返す。

### P0-3: 打刻保存と監査ログ連動
- 担当: @backend
- 依存: P0-2
- 完了条件:
  - `source=desktop_nfc` / `source=desktop_user_id` が正しく保存される。
  - `attendance_change_logs` が打刻変更時に追記される。
  - 本体更新と履歴保存が同一トランザクションで処理される。

### P0-4: Desktop のカード忘れ打刻 UI と送信対応
- 担当: @nfc
- 依存: P0-2
- 完了条件:
  - 打刻画面で `user_id` と `reason` の入力打刻が可能。
  - 通常打刻とカード忘れ打刻の送信を切替できる。
  - 404/409 のメッセージ表示が適切。

### P1-1: 管理画面の表示追従（full_name / source）
- 担当: @frontend
- 依存: P0-3
- 完了条件:
  - `full_name` が表示される。
  - `desktop_user_id` 打刻が識別可能なラベルで表示される。

### P1-2: 変更履歴画面の実装
- 担当: @frontend
- 依存: P0-3
- 完了条件:
  - `/attendance/{attendance_id}/history` の結果を一覧表示できる。
  - 変更前後、理由、実行者、実行日時を確認できる。

### P1-3: 結合テストと最終整合チェック
- 担当: @reviewer（実装担当と共同）
- 依存: P0-1〜P1-2
- 完了条件:
  - 契約・DB・Desktop・Frontend の整合が確認できる。
  - 主要シナリオ（通常打刻、カード忘れ打刻、履歴表示）が通る。

## 16. 実行開始の指示文（各担当へ貼り付け用）

### @database へ
- `docs/database-design.md` を基準に、P0-1 を実装してください。
- Alembic は SQLite 前提で `render_as_batch=True` を考慮してください。

### @backend へ
- `docs/api-contract.openapi.yaml` と `docs/architecture.md` の P0-2/P0-3 を実装してください。
- 特に POST `/punches` の oneOf 入力条件と監査ログ連動を厳守してください。

### @nfc へ
- `docs/api-contract.openapi.yaml` の `PunchRequest` に合わせ、P0-4 を実装してください。
- user_id 打刻時は reason を必須にしてください。

### @frontend へ
- P1-1/P1-2 を実装してください。
- `full_name`、`source` 表示、履歴表示の 3 点を優先してください。
