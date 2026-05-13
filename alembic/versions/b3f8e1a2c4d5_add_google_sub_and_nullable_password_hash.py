"""add_google_sub_and_nullable_password_hash

Revision ID: b3f8e1a2c4d5
Revises: d234dca50cf1
Create Date: 2026-05-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f8e1a2c4d5'
down_revision: Union[str, None] = 'd234dca50cf1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite: ALTER TABLE はバッチモードで実施
    with op.batch_alter_table('users', schema=None) as batch_op:
        # password_hash を NULL 許容に変更 (GSI 認証ユーザーはパスワード不要)
        batch_op.alter_column('password_hash', existing_type=sa.String(), nullable=True)
        # google_sub カラムを追加 (Google Identity Services の sub クレーム)
        batch_op.add_column(sa.Column('google_sub', sa.String(), nullable=True))
        batch_op.create_unique_constraint('uq_users_google_sub', ['google_sub'])


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('uq_users_google_sub', type_='unique')
        batch_op.drop_column('google_sub')
        # password_hash を NOT NULL に戻す
        # 注意: NULL 値が存在する場合はダウングレードが失敗する可能性がある
        batch_op.alter_column('password_hash', existing_type=sa.String(), nullable=False)
