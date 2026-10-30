# メール送信設定（Resend）

Kint がメールを送る仕組みと、そのための環境変数・DNS 設定・トラブル対応をまとめます。

---

## 1. 概要

Kint は次のメールを送ります。

| 種類 | 送るタイミング | 実装 |
| :--- | :--- | :--- |
| メールアドレス変更の確認メール | マイページでメールアドレス変更を申請したとき | `UserService.request_email_change` |
| 月次勤務実績レポート | 毎月末日の指定時刻（自動）／管理者の手動送信 | `AttendanceService.send_monthly_attendance_reports` |

### 送信方式
- **送信方式**: [Resend](https://resend.com/) の HTTP API（`POST https://api.resend.com/emails`）
- **実装**: `src/kint/services/mailer.py` の `MailAdapter`（httpx で直接呼ぶ。SDK は使わない）
- **差出人（From）**: `サイト名 <MAIL_FROM>`
  - 月次レポート: 「システム設定」のサイト名（DB の `site_name`）
  - 確認メール: 環境変数 `SITE_NAME`（未設定時は `Kint`）
- **返信先（Reply-To）**: `MAIL_REPLY_TO`（未設定時は `MAIL_FROM`）
- **本文**: テキスト形式のみ

> [!NOTE]
> 送信元アドレスには、m-pass と同じく Resend でドメイン認証済みの `tukumana.si.aoyama.ac.jp` のアドレス（例: `noreply@tukumana.si.aoyama.ac.jp`）を使います。同じドメインであれば、m-pass と同じアドレスからも、別のアドレス（例: `kint@tukumana.si.aoyama.ac.jp`）からも送信できます。

---

## 2. 環境変数

| 変数 | 必須 | 説明 |
| :--- | :--- | :--- |
| `RESEND_API_KEY` | ○ | Resend の API キー（`re_` で始まる）。[API Keys](https://resend.com/api-keys) で発行する。m-pass と同じ Resend アカウントのキーを使ってもよいが、Kint 用に別のキーを発行すると、失効させるときに影響範囲を分けられる |
| `MAIL_FROM` | ○ | 送信元アドレス。Resend で Verified になっているドメインのアドレスにする |
| `MAIL_REPLY_TO` | － | 返信先アドレス。未設定時は `MAIL_FROM` |

`RESEND_API_KEY` か `MAIL_FROM` が未設定の場合、メール送信は `MAIL_NOT_CONFIGURED` エラー（HTTP 502）になります。それ以外の機能は動作します。

### 本番サーバーの `.env` 例

```dotenv
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
MAIL_FROM=noreply@tukumana.si.aoyama.ac.jp
# MAIL_REPLY_TO=tukumanalab@gmail.com
```

設定を変えたら PM2 でバックエンドを再起動します（`pm2 restart kint` など）。

### Gmail API からの移行
- 以前の `GMAIL_USER` / `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` / `GMAIL_TOKEN_FILE` / `GMAIL_OAUTH_CREDENTIALS_FILE` / `GMAIL_SENDER_EMAIL` は使いません。`.env` に残っていても起動はできますが、削除してください。`gmail_token.json` も不要です。
- `email_verification_requests.sent_via` の値は、新しく作る行では `resend` になります。移行前の行は `gmail_api` のまま残ります（`alembic upgrade head` で CHECK 制約に `resend` が追加されます）。

---

## 3. メール認証（SPF / DKIM / DMARC）

`tukumana.si.aoyama.ac.jp` は m-pass の移行時に Resend でドメイン登録・認証が済んでいるため、Kint 側で DNS を追加設定する必要はありません。別のドメインから送る場合や、DNS を再設定する場合は、m-pass の `docs/mail-settings.md` の第 4 章と同じ手順で行います。

1. [Resend の Domains](https://resend.com/domains) でドメインを追加し、表示された MX / TXT（SPF）と TXT（DKIM）のレコードを DNS に登録する
2. DMARC（`_dmarc.<ドメイン>` の TXT）を登録する
3. Resend で **Verify DNS Records** を押し、**Verified** になることを確認する

反映を確認するコマンド:

```bash
dig TXT resend._domainkey.tukumana.si.aoyama.ac.jp +short
dig TXT _dmarc.tukumana.si.aoyama.ac.jp +short
```

届いたメールのヘッダー（Gmail なら「メッセージのソースを表示」）で `SPF: PASS` / `DKIM: PASS` / `DMARC: PASS` になっていれば OK です。

---

## 4. トラブルシューティング

### Q1: `MAIL_NOT_CONFIGURED` が返る
- **原因**: `RESEND_API_KEY` または `MAIL_FROM` が未設定です。ログには、どちらが `NOT SET` かが出力されます。
- **対処**: `.env` に設定してバックエンドを再起動します。

### Q2: `MAIL_SEND_FAILED` が返る
- **原因**: Resend への通信に失敗したか、Resend がエラーを返しました。ログの `Resend 送信エラー: ... status=... error=<name>: <message>` に Resend からのエラー内容が出力されます。
- **よくある例**:
  - `401` / `403`（`missing_api_key` / `invalid_api_key` など）: API キーが無効です。キーを確認・再発行してください
  - `403`（`validation_error`。ドメインが未認証という内容）: `MAIL_FROM` のドメインが Resend で Verified になっていません
  - `422`（`validation_error`）: 宛先や送信元アドレスの形式が不正です
  - `429`: 送信数の上限に達しています（m-pass と同じアカウントの場合、両方の送信数の合計で数えられます）

### Q3: DMARC が FAIL になる
- `MAIL_FROM` のドメインが、Resend で認証したドメインと完全に一致しているか確認してください。
