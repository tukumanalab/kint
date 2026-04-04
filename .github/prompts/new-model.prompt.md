---
description: "新しいデータモデルとマイグレーションを作成する"
agent: "agent"
tools: [read, edit, search, execute]
argument-hint: "モデルの目的（例: 休暇申請テーブル）"
---

以下の手順で新しいデータモデルを作成してください:

1. `src/kint/models/` にSQLAlchemyモデルを作成（Mapped記法）
2. `src/kint/models/__init__.py` にインポートを追加
3. Alembic マイグレーションを自動生成: `alembic revision --autogenerate -m "説明"`
4. 生成されたマイグレーションファイルの `upgrade()` と `downgrade()` を確認
5. マイグレーション実行: `alembic upgrade head`

全テーブルに `created_at`, `updated_at` カラムを含めること。
