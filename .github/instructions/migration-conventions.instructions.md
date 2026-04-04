---
description: "Database migration conventions for Alembic migration files with SQLite. Use when writing or reviewing migration scripts."
applyTo: "alembic/versions/*.py"
---

# マイグレーション規約

- `upgrade()` と `downgrade()` は必ず両方実装する
- NOT NULL カラム追加時はデフォルト値を設定するか、段階的マイグレーションにする
- テーブル名は複数形スネークケース（例: `users`, `attendance_records`）
- `created_at`, `updated_at` カラムを全テーブルに含める
- 外部キーには適切な ON DELETE を設定する
- インデックス名は `ix_<table>_<column>` の形式にする
- **SQLite 必須**: `render_as_batch=True` を env.py で設定する（ALTER TABLE 制限対応）
