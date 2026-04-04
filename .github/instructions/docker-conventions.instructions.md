---
description: "Docker and deployment conventions for the Kint attendance system. Use when writing Dockerfiles, docker-compose files, or CI/CD configurations."
applyTo: ["Dockerfile", "docker-compose*.yml", ".github/workflows/*.yml"]
---

# Docker / デプロイ規約

- マルチステージビルドでイメージを軽量化する（Node.js ビルド → Python ランタイム）
- シークレットはビルド時に含めない（環境変数で注入）
- ヘルスチェックを必ず設定する
- non-root ユーザーで実行する
- `.dockerignore` で `desktop/`, `node_modules/` 等の不要ファイルを除外する
- SQLite DB ファイルは volume でホストにマウントする
- NFC読み取りは Windows デスクトップアプリで行うため、サーバーにUSBデバイスは不要
