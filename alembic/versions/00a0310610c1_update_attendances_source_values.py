"""update_attendances_source_values

Revision ID: 00a0310610c1
Revises: 13ecfcc50f59
Create Date: 2026-04-06 14:47:48.184950

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '00a0310610c1'
down_revision: Union[str, None] = '13ecfcc50f59'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_SOURCE_CHECK = "source IN ('webusb_nfc', 'web_user_id', 'admin_manual', 'self_service')"
_OLD_SOURCE_CHECK = "source IN ('desktop_nfc', 'desktop_user_id', 'admin_manual', 'self_service')"


def upgrade() -> None:
    # SQLite では CHECK 制約の変更にバッチモード（テーブル再作成）が必要
    with op.batch_alter_table("attendances", schema=None) as batch_op:
        batch_op.drop_constraint("ck_attendances_source", type_="check")
        batch_op.create_check_constraint("ck_attendances_source", _NEW_SOURCE_CHECK)


def downgrade() -> None:
    with op.batch_alter_table("attendances", schema=None) as batch_op:
        batch_op.drop_constraint("ck_attendances_source", type_="check")
        batch_op.create_check_constraint("ck_attendances_source", _OLD_SOURCE_CHECK)
