---
name: db-migration
description: "データベースマイグレーション作成・実行。Use when creating Alembic migrations for SQLite, modifying database schema, adding tables or columns, or running migration commands."
argument-hint: "マイグレーションの内容を記述してください"
---

# データベースマイグレーション

## いつ使うか
- テーブルの追加・変更・削除
- カラムの追加・変更
- インデックスの追加
- 制約の追加・変更

## 手順

1. **モデル変更**: `src/kint/models/` の SQLAlchemy モデルを更新する
2. **マイグレーション生成**:
   ```bash
   alembic revision --autogenerate -m "説明"
   ```
3. **マイグレーション確認**: 生成されたファイルの `upgrade()` と `downgrade()` を確認する
4. **マイグレーション実行**:
   ```bash
   alembic upgrade head
   ```
5. **ロールバックテスト**:
   ```bash
   alembic downgrade -1
   alembic upgrade head
   ```

## 注意事項

- NOT NULL カラム追加時はデフォルト値を設定するか、段階的にマイグレーションする
- データ移行が必要な場合は `op.execute()` で SQL を書く
- downgrade は必ず実装する
- **SQLite 固有の制約**: `render_as_batch=True` を Alembic の `env.py` で設定すること（ALTER TABLE の制限対応）
- SQLite ではカラム削除・カラム型変更にバッチモードが必要

## マイグレーションファイルのテンプレート

```python
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision}
"""
from alembic import op
import sqlalchemy as sa

revision = "${up_revision}"
down_revision = "${down_revision}"

def upgrade() -> None:
    op.create_table(
        "table_name",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

def downgrade() -> None:
    op.drop_table("table_name")
```
