"""drop_attendances_user_work_date_unique

Revision ID: f6a7b8c9d0e1
Revises: e1f2a3b4c5d6
Create Date: 2026-05-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("attendances") as batch_op:
        batch_op.drop_constraint("uq_attendances_user_work_date", type_="unique")


def downgrade() -> None:
    with op.batch_alter_table("attendances") as batch_op:
        batch_op.create_unique_constraint(
            "uq_attendances_user_work_date",
            ["user_id", "work_date"],
        )
