"""add_face_descriptors

Revision ID: b4d8f2a91c3e
Revises: d7b9076af7b7
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d8f2a91c3e'
down_revision: Union[str, None] = 'd7b9076af7b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_SOURCE_CHECK = "source IN ('webusb_nfc', 'web_user_id', 'admin_manual', 'self_service')"
_NEW_SOURCE_CHECK = (
    "source IN ('webusb_nfc', 'web_user_id', 'admin_manual', 'self_service', 'webcam_face')"
)


def upgrade() -> None:
    op.create_table(
        'face_descriptors',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('descriptor', sa.LargeBinary(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_face_descriptors_user_id'), 'face_descriptors', ['user_id'], unique=False
    )

    # SQLite では CHECK 制約の変更にバッチモード（テーブル再作成）が必要
    with op.batch_alter_table('attendances', schema=None) as batch_op:
        batch_op.drop_constraint('ck_attendances_source', type_='check')
        batch_op.create_check_constraint('ck_attendances_source', _NEW_SOURCE_CHECK)


def downgrade() -> None:
    with op.batch_alter_table('attendances', schema=None) as batch_op:
        batch_op.drop_constraint('ck_attendances_source', type_='check')
        batch_op.create_check_constraint('ck_attendances_source', _OLD_SOURCE_CHECK)

    op.drop_index(op.f('ix_face_descriptors_user_id'), table_name='face_descriptors')
    op.drop_table('face_descriptors')
