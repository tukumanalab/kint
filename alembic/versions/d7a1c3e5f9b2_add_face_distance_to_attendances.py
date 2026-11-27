"""add_face_distance_to_attendances

Revision ID: d7a1c3e5f9b2
Revises: c3e5a7b9d1f2
Create Date: 2026-11-27 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd7a1c3e5f9b2'
down_revision: Union[str, None] = 'c3e5a7b9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """顔認証打刻の照合距離（出勤・退勤）を記録するカラムを追加する。"""
    with op.batch_alter_table('attendances', schema=None) as batch_op:
        batch_op.add_column(sa.Column('check_in_face_distance', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('check_out_face_distance', sa.Float(), nullable=True))


def downgrade() -> None:
    """照合距離カラムを削除する。"""
    with op.batch_alter_table('attendances', schema=None) as batch_op:
        batch_op.drop_column('check_out_face_distance')
        batch_op.drop_column('check_in_face_distance')
