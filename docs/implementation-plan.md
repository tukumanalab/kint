# Kint 実装計画

## 0. 実行環境方針
- Server は Linux 上で FastAPI を実行する。
- 打刻クライアントは専用 Desktop アプリではなく、Web ブラウザ上の React アプリで実行する。
- NFC 読み取りは WebUSB を利用し、PaSoRi を USB 接続して IDm を取得する。
- Python 依存は Server のみで管理し、クライアント側は Node.js 依存で管理する。

## 0-1. 対応ブラウザ確定（実装前提）
- 公式サポート: Windows 11 + Chrome / Edge（最新安定版）
- 準サポート: Windows 10 + Chrome / Edge（最新安定版）
- 非サポート: Firefox / Safari / モバイルブラウザ

## 0-2. 運用要件確定（実装前提）
- 打刻ページは HTTPS 配信（開発時 `localhost` 許容）。
- 打刻画面で WebUSB 接続状態を表示する。
- WebUSB 失敗時は user_id + reason の代替打刻へ遷移する。
- サポート外ブラウザは打刻 UI を無効化し、案内メッセージを表示する。

## 1. 実装チケット分解（@backend 向け）

### BE-01: 打刻 API 入力拡張（WebUSB NFC / user_id 両対応）
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
  - attendances.source に webusb_nfc / web_user_id を保存。
  - PunchResponse に method（card_idm / user_id）を追加する。
- 受け入れ条件:
  - NFC 打刻で source=webusb_nfc, method=card_idm が返る。
  - user_id 打刻で source=web_user_id, method=user_id が返る。

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
  - Frontend(WebUSB) 向け仕様（入力とエラーコード）を確認。
- 受け入れ条件:
  - API 実装が契約と整合し、フロント連携のブロッカーがない。

### BE-08: ユーザー管理 API 実装（管理者）
- 目的:
  - 管理者がユーザーを登録/修正/削除できるようにする。
- 実装範囲:
  - POST /users、PATCH /users/{user_id}、DELETE /users/{user_id} を実装。
  - DELETE は論理削除（is_active=false）で実装。
- 受け入れ条件:
  - 管理者のみ実行可能で、一般ユーザーは 403 を返す。
  - 論理削除後ユーザーは打刻・ログインができない。

## 2. 実装チケット分解（@database 向け）

### DB-01: users への full_name 追加
- 目的:
  - 本名データを保持できるようにする。
- 実装範囲:
  - SQLAlchemy モデルへ full_name（NOT NULL）を追加。
  - 既存データがある場合は段階的 migration（暫定値投入後に NOT NULL 化）を検討。
- 受け入れ条件:
  - users.full_name が必須項目として保存・取得できる。

### DB-02: attendances.source 列挙値拡張
- 目的:
  - WebUSB 打刻と user_id 打刻を区別して保存する。
- 実装範囲:
  - CHECK 制約へ webusb_nfc / web_user_id を追加。
  - 既存行の整合性を確認し、制約更新時の失敗を防ぐ。
- 受け入れ条件:
  - webusb_nfc / web_user_id / admin_manual / self_service のみ保存可能。

### DB-03: 変更履歴テーブル運用保証
- 目的:
  - 勤怠変更の監査証跡を完全に残す。
- 実装範囲:
  - attendance_change_logs のモデル定義と FK/INDEX を実装。
  - アプリ層から UPDATE/DELETE を行わない運用を徹底。
- 受け入れ条件:
  - 勤怠修正時に履歴が追記され、履歴の欠落が発生しない。

### DB-04: Alembic マイグレーション作成（SQLite 対応）
- 目的:
  - 追加/変更したスキーマを安全に適用する。
- 実装範囲:
  - upgrade() / downgrade() を両実装。
  - SQLite の制約を考慮し render_as_batch=True 前提で migration を記述。
  - alembic downgrade -1 / upgrade head の往復検証。
- 受け入れ条件:
  - 新規環境と既存環境の両方で migration が成功する。

### DB-05: ユーザー論理削除運用の固定化
- 目的:
  - ユーザー削除時のデータ整合性を保証する。
- 実装範囲:
  - users.is_active を基準に論理削除を統一。
  - 打刻・認証・関連取得時に is_active 判定を適用。
- 受け入れ条件:
  - 論理削除ユーザーの新規業務操作が禁止される。

## 3. 実装チケット分解（@frontend 向け）

### FE-00: WebUSB-FeliCa 技術検証
- 目的:
  - ブラウザから PaSoRi を認識し、IDm を取得できることを確認する。
- 実装範囲:
  - WebUSB 対応ブラウザで接続処理を実装。
  - 参照: https://github.com/marioninc/webusb-felica/blob/gh-pages/demo.html
- 受け入れ条件:
  - サポート対象ブラウザで PaSoRi 接続と IDm 読み取りが成功する。
  - 非サポートブラウザでサポート外メッセージが表示される。

### FE-01: 打刻画面（WebUSB NFC / user_id フォールバック）
- 目的:
  - Web アプリ内で打刻を完結できるようにする。
- 実装範囲:
  - WebUSB 接続ボタン、IDm 読み取り、打刻送信 UI を実装。
  - WebUSB 非対応またはカード忘れ時の user_id + reason 入力導線を実装。
  - 接続状態（未接続/接続中/読取成功/エラー）を表示。
- 受け入れ条件:
  - 通常打刻とフォールバック打刻の両方を UI で実行できる。
  - 接続失敗時に復旧手順と代替導線が提示される。

### FE-02: API クライアント更新
- 目的:
  - 追加された打刻契約に追従する。
- 実装範囲:
  - PunchRequest の oneOf 条件を型で表現。
  - PunchResponse.method と AttendanceRecord.source=webusb_nfc/web_user_id を反映。
- 受け入れ条件:
  - 型チェックで契約差分エラーが発生しない。

### FE-03: 管理画面の勤怠表示更新
- 目的:
  - 打刻方法の識別情報を管理画面で確認可能にする。
- 実装範囲:
  - 勤怠一覧に打刻元 source を表示。
  - web_user_id の場合は「カード忘れ（user_id）」とラベル表示。
- 受け入れ条件:
  - 管理者が WebUSB 打刻と user_id 打刻を画面上で判別できる。

### FE-04: 変更履歴画面の拡張
- 目的:
  - 監査要件として変更履歴を確認できるようにする。
- 実装範囲:
  - /attendance/{attendance_id}/history の取得 UI を追加。
  - 変更前/変更後/理由/実行者/実行日時を表示。
- 受け入れ条件:
  - 対象勤怠に対して時系列の変更履歴を閲覧できる。

### FE-05: フロントエンドテスト更新
- 目的:
  - 契約変更に伴う表示回帰を防止する。
- 実装範囲:
  - full_name 表示テストを追加。
  - source 表示ラベル変換テストを追加。
  - 打刻画面の WebUSB 成功/失敗分岐テストを追加。
  - 変更履歴表示コンポーネントのレンダリングテストを追加。
- 受け入れ条件:
  - 主要 UI ケースが自動テストで担保される。

### FE-06: ユーザー管理画面実装（管理者）
- 目的:
  - 管理者がユーザーを登録/修正/削除できるようにする。
- 実装範囲:
  - ユーザー一覧、登録フォーム、編集フォーム、削除（論理削除）操作を実装。
  - 管理者以外には画面導線を表示しない。
- 受け入れ条件:
  - 管理者が UI 上でユーザー登録/修正/削除を実行できる。
  - 削除済みユーザーの状態が画面で識別できる。

## 4. 依存関係と着手順

### 4-1. 依存マトリクス
- FE-00 は全体の前提タスクとして最優先で着手する。
- BE-01 は DB-02 完了前でも実装開始可能（ただし結合試験は DB-02 後）。
- BE-03 は DB-03 と同時進行可能だが、最終確認は DB-04 後。
- BE-08 は DB-05 と並行可能だが、最終確認は DB-05 後。
- FE-02 は BE-01 と API 契約確定後に着手可能。
- FE-03 は BE-03（source 保存）完了後に結合確認。
- FE-04 は BE-04（履歴保存）と /attendance/{attendance_id}/history 実装完了後に結合確認。
- FE-06 は BE-08 実装後に結合確認。
- FE-05 は FE-01〜04 の完了後に実施。

### 4-2. 推奨スケジュール（2 スプリント）

```mermaid
gantt
  title WebUSB 打刻対応の実装計画
  dateFormat  YYYY-MM-DD

  section Sprint 1
  FE-00 WebUSB 技術検証               :f0, 2026-04-07, 2d
  DB-01 users.full_name 追加           :a1, 2026-04-07, 2d
  DB-02 attendances.source 拡張        :a2, after a1, 1d
  DB-03 変更履歴テーブル運用保証       :a3, after a2, 2d
  BE-01 打刻 API 入力拡張              :b1, 2026-04-07, 3d
  BE-02 利用者解決ロジック             :b2, after b1, 2d
  FE-01 打刻画面 WebUSB 実装           :f1, after f0, 3d
  FE-02 API クライアント更新           :f2, after b1, 2d

  section Sprint 2
  DB-04 Alembic migration 検証         :a4, 2026-04-15, 2d
  DB-05 ユーザー論理削除運用固定        :a5, after a4, 1d
  BE-03 source/method 反映             :b3, after a4, 1d
  BE-04 監査ログ連携                   :b4, after b3, 2d
  BE-05 エラーレスポンス統一           :b5, after b4, 1d
  BE-08 ユーザー管理 API               :b8, after a5, 2d
  FE-03 勤怠表示更新                   :f3, after b3, 2d
  FE-04 変更履歴画面                   :f4, after b4, 2d
  FE-06 ユーザー管理画面               :f6, after b8, 2d
  BE-06/FE-05 テスト                   :t1, after f6, 2d
  BE-07 最終整合確認                   :r1, after t1, 1d
```

## 5. 統合受け入れ条件（全チーム）
- 通常打刻: WebUSB で IDm を読み取り打刻でき、source=webusb_nfc で保存される。
- カード忘れ打刻: user_id + reason で打刻でき、source=web_user_id で保存される。
- 修正監査: 勤怠修正時に履歴が欠落なく追記される。
- 表示整合: 管理画面で full_name、打刻元、変更履歴が正しく表示される。
- 契約整合: API 実装と Frontend が docs/api-contract.openapi.yaml と一致する。

## 6. 起票用バックログ（このまま Issue 化可能）

### P0-0: WebUSB 技術検証と対応ブラウザ確定
- 担当: @frontend
- 依存: なし
- 完了条件:
  - PaSoRi 接続と IDm 読み取りが再現できる。
  - 対応ブラウザ・非対応ブラウザ時の挙動を定義できる。
  - Windows 11 + Chrome / Edge で打刻動作確認が完了する。

### P0-1: DB マイグレーション実装（full_name と source 拡張）
- 担当: @database
- 依存: なし
- 完了条件:
  - users.full_name が追加される。
  - attendances.source に webusb_nfc / web_user_id が追加される。
  - upgrade/downgrade の往復が成功する。

### P0-2: 打刻 API 拡張（card_idm / user_id oneOf）
- 担当: @backend
- 依存: P0-1
- 完了条件:
  - POST /punches が card_idm と user_id+reason の双方を受理する。
  - reason 欠落時は 422 を返す。
  - 未登録 card_idm/user_id で 404 を返す。

### P0-3: Web 打刻画面（WebUSB / user_id）実装
- 担当: @frontend
- 依存: P0-0, P0-2
- 完了条件:
  - 打刻画面で WebUSB 打刻と user_id 打刻の両方が可能。
  - 404/409 のメッセージ表示が適切。

### P1-1: 打刻保存と監査ログ連動
- 担当: @backend
- 依存: P0-2
- 完了条件:
  - source=webusb_nfc / source=web_user_id が正しく保存される。
  - attendance_change_logs が打刻変更時に追記される。

### P1-2: ユーザー管理 API（管理者）
- 担当: @backend
- 依存: P0-1
- 完了条件:
  - 管理者がユーザー登録/修正/削除（論理削除）を実行できる。
  - 一般ユーザーは 403 となる。

### P1-3: 管理画面の表示追従・履歴画面・ユーザー管理
- 担当: @frontend
- 依存: P1-1, P1-2
- 完了条件:
  - source と履歴が UI で確認できる。
  - 管理者がユーザー登録/修正/削除を UI で実行できる。

### P1-4: 結合テストと最終整合チェック
- 担当: @reviewer（実装担当と共同）
- 依存: P0-1〜P1-3
- 完了条件:
  - 契約・DB・Frontend の整合が確認できる。
  - 主要シナリオ（WebUSB 打刻、カード忘れ打刻、履歴表示、ユーザー管理）が通る。

## 7. 実行開始の指示文（各担当へ貼り付け用）

### @frontend へ
- まず P0-0 を実施し、WebUSB-FeliCa の接続性を確認してください。
- 次に P0-3 を実装し、Web 打刻画面で WebUSB 打刻と user_id フォールバックを提供してください。
- サポート外ブラウザ表示と接続状態表示を必須要件として実装してください。
- P1-3 で管理者向けユーザー管理画面を実装してください。

### @backend へ
- docs/api-contract.openapi.yaml と docs/architecture.md の方針に従い、P0-2、P1-1、P1-2 を実装してください。
- 特に POST /punches の oneOf 入力条件と監査ログ連動を厳守してください。

### @database へ
- docs/database-design.md を基準に、P0-1 を実装してください。
- Alembic は SQLite 前提で render_as_batch=True を考慮してください。

### @reviewer へ
- P1-3 で WebUSB 打刻導線を含む結合観点レビューを実施してください。
