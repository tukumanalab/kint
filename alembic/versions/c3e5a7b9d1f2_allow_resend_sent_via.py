"""allow_resend_sent_via

Revision ID: c3e5a7b9d1f2
Revises: b4d8f2a91c3e
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3e5a7b9d1f2'
down_revision: Union[str, None] = 'b4d8f2a91c3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT_NAME = 'ck_email_verification_requests_sent_via'
_OLD_CHECK = "sent_via IN ('gmail_api')"
_NEW_CHECK = "sent_via IN ('gmail_api', 'resend')"


def upgrade() -> None:
    """メール送信手段に Resend を追加する（既存の gmail_api 行はそのまま残す）。"""
    with op.batch_alter_table('email_verification_requests', schema=None) as batch_op:
        batch_op.drop_constraint(_CONSTRAINT_NAME, type_='check')
        batch_op.create_check_constraint(_CONSTRAINT_NAME, _NEW_CHECK)


def downgrade() -> None:
    """Resend で送信した行を gmail_api に戻し、制約を元に戻す。"""
    op.execute(
        "UPDATE email_verification_requests SET sent_via = 'gmail_api' "
        "WHERE sent_via = 'resend'"
    )
    with op.batch_alter_table('email_verification_requests', schema=None) as batch_op:
        batch_op.drop_constraint(_CONSTRAINT_NAME, type_='check')
        batch_op.create_check_constraint(_CONSTRAINT_NAME, _OLD_CHECK)
