# シフトカレンダー同期機能設計書

## 1. 概要
指定されたiCal（iCalendar）形式のURLからシフトデータを取得し、データベースの `shifts` テーブルと同期する機能の設計です。Google Calendar APIの直接連携ではなく、iCalデータのURLからの取り込みを行います。

## 2. データソース
- **URL**: 環境変数 `SHIFT_ICAL_URL` で指定する iCal 配信 URL
  - 例: `https://tukumana.si.aoyama.ac.jp/shift2/api/ical/all?token=...`
- **フォーマット**: iCalendar (`.ics`)

### 設定ポリシー
- iCal の参照先 URL はコードへ直書きせず、必ず `SHIFT_ICAL_URL` から取得する。
- `SHIFT_ICAL_URL` が未設定の場合は同期処理を開始せず、設定不足として扱う。

## 3. データのマッピング仕様
iCal 内の `VEVENT`（イベント情報）をDBの `Shift` モデルへマッピングします。

| iCal (`VEVENT`) 項目 | `Shift` モデルカラム | 備考 |
| --- | --- | --- |
| `UID` | `google_event_id` | 一意となるイベントID。既存のカラム名（`google_event_id`）をそのまま流用し格納します。 |
| `DTSTART` | `start_time` | シフトの開始日時。タイムゾーンが適用された日時として扱います。 |
| `DTEND` | `end_time` | シフトの終了日時。 |
| `DTSTART` (日付) | `shift_date` | `DTSTART` から日付のみを抽出して登録。 |
| `ATTENDEE;ROLE=REQ-PARTICIPANT:MAILTO:<mail>` | `user_id` | `<mail>` の部分を取り出し、システム内の `User.email` を検索。該当するユーザーのIDを保存します。 |

### ユーザーの紐付け (判別処理)
1. `ATTENDEE` 行から `MAILTO:` 以降のメールアドレス文字列を抽出。
2. データベースの `users` テーブルに対して、`email` が一致するユーザーを検索。
3. 一致したユーザーの `id` を `user_id` として紐付け。
   - ※一致するユーザーが存在しない場合、該当シフトはスキップし、システムログに警告出力を行います。

## 4. 同期ロジック設計

### 4.1 更新・追加 (Upsert)
同期実行時、iCalデータ内のすべての `VEVENT` をパースし、以下のルールでデータベースに反映します。
- `UID` (`google_event_id`) をキーにして `shifts` テーブルを検索。
- **データが存在しない場合**: `INSERT` して新規シフトとして登録。
- **データが存在する場合**: `start_time` や `end_time` に変更がある場合のみ、データを `UPDATE`。変更がなければ何もしない。

### 4.2 削除の検知
カレンダー元データで予定が削除された場合、iCalデータからも消失します。
- **削除ロジック**: 
  1. 今回iCalから取得できた対象期間（例：本日以降の一定期間）の全 `UID` をリスト化。
  2. DB上に存在する「今日以降のシフト」のうち、取得した `UID` リストに含まれないものは、「元のカレンダー上で削除されたシフト」と判断し、DB上から削除します。

## 5. 新規使用ライブラリ
- **`icalendar`**: PythonのiCalendarパース用ライブラリ 
  （`uv add icalendar` あるいは `urllib` と標準機能でのパースも可能ですが、フォーマット変更に強くするためライブラリの利用を推奨）

## 6. 必要な実装タスク
1. **ライブラリ追加**: `pyproject.toml` へ `icalendar` 等を追加し環境を更新。
2. **同期サービスクラスの作成**: `src/kint/services/calendar_sync.py` を作成し、HTTP GETによるファイル取得・パース・DBへのUpsertロジックを実装。
3. **APIエンドポイント作成**: `src/kint/routers/calendar.py` に `POST /api/calendar/sync` 等を作成し、フロントエンドから手動で同期する機能を提供する。
