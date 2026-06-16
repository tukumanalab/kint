---
name: deploy
description: "リモートサーバーへの最新コードのデプロイ・更新手順。Use when deploying updates to the remote server, executing migrations, building frontend, and restarting PM2 processes."
---

# リモートデプロイ手順

## いつ使うか
- リモートサーバー (`ky@tukumana.si.aoyama.ac.jp` など) のデプロイ済みシステムを最新の GitHub リポジトリ（`main` ブランチ）で更新する場合。
- リモート環境におけるバックエンドの再起動、マイグレーションの実行、フロントエンドの再ビルドが必要な場合。

## 事前確認項目
1. **リモートサーバー情報**:
   - ホスト: `ky@tukumana.si.aoyama.ac.jp`
   - ディレクトリ: `/srv/kint`
2. **環境変数ファイルの確認**:
   - `/srv/kint/.env` に `GOOGLE_CLIENT_ID` や必要なバックエンド環境変数が存在することを確認する。

## 手順

### 1. 最新コードのプル
リモートサーバー上で最新の `main` ブランチを取得します。
```bash
ssh ky@tukumana.si.aoyama.ac.jp "cd /srv/kint && git pull origin main"
```

### 2. バックエンドのパッケージ同期とデータベースマイグレーション
Python のパッケージ依存関係を同期し、データベースのスキーマを最新状態に更新します。リモート環境では `uv` が `/home/ky/.local/bin/uv` にインストールされている場合があるため、フルパスでの実行を推奨します。
```bash
# 依存関係の同期
ssh ky@tukumana.si.aoyama.ac.jp "cd /srv/kint && /home/ky/.local/bin/uv sync"

# スキーマの更新
ssh ky@tukumana.si.aoyama.ac.jp "cd /srv/kint && /home/ky/.local/bin/uv run alembic upgrade head"
```

### 3. フロントエンドのビルド
Node.js 依存関係をインストールし、環境変数 `VITE_GOOGLE_CLIENT_ID` およびデプロイパス（例: `VITE_BASE_PATH=/kintai/`）を指定してフロントエンドを本番ビルドします。非インタラクティブセッション用に `nvm` の環境設定をロードして実行します。
```bash
ssh ky@tukumana.si.aoyama.ac.jp "export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && cd /srv/kint/frontend && npm install && VITE_GOOGLE_CLIENT_ID=138259612704-gtcg1asac7k62r6agdunn6e6kmpoqal0.apps.googleusercontent.com VITE_BASE_PATH=/kintai/ npm run build"
```

### 4. PM2 プロセスの再起動
アプリケーションサーバー (`kint-backend`) を再起動して変更を適用します。
```bash
ssh ky@tukumana.si.aoyama.ac.jp "pm2 restart kint-backend"
```

### 5. Nginx 設定ファイルの置換適用（デプロイパスを変更する場合のみ）
任意のデプロイパス（例: `/kintai`）に変更する場合は、Nginx設定ファイルを置換して配置し、Nginx をリロードします。
```bash
ssh ky@tukumana.si.aoyama.ac.jp "sed 's/\/kint/\/kintai/g' /srv/kint/nginx/kint.conf | sed 's/\/srv\/kintai/\/srv\/kint/g' | sudo tee /etc/nginx/kint.conf && sudo nginx -t && sudo systemctl reload nginx"
```

## 注意事項と確認項目
- **一時的な瞬断**: ビルドやプロセスの再起動中、システムに一時的なアクセス不可の時間が発生します。
- **動作確認ログ**: 起動後は以下のコマンドでログを確認してください。
  ```bash
  ssh ky@tukumana.si.aoyama.ac.jp "tail -n 50 /home/ky/.pm2/logs/kint-backend-out-1.log"
  ssh ky@tukumana.si.aoyama.ac.jp "tail -n 50 /home/ky/.pm2/logs/kint-backend-error-1.log"
  ```
