"""アラート確認・解除 API のテスト。"""

from datetime import date, datetime
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from kint.models.attendance import AttendanceAlertAcknowledgment
from kint.models.user import User
from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_alert_acknowledgment(client: AsyncClient, session) -> None:
    # テストユーザー（管理者と一般従業員）を作成
    admin = await _create_user(
        session,
        id="admin_user",
        name="管理者",
        full_name="Admin User",
        email="admin@example.com",
        role="admin",
    )
    emp = await _create_user(
        session,
        id="emp_user",
        name="一般社員",
        full_name="Employee User",
        email="emp@example.com",
        role="employee",
    )

    admin_token = await _login(client, "admin_user")
    emp_token = await _login(client, "emp_user")

    # 1. アラートを確認済みにするテスト
    payload = {
        "date": "2026-05-15",
        "rule_id": "test_rule"
    }

    # 一般従業員がやろうとすると403になる
    response = await client.post(
        f"/api/v1/attendance/{emp.id}/alerts/acknowledge",
        json=payload,
        headers={"Authorization": f"Bearer {emp_token}"}
    )
    assert response.status_code == 403

    # 管理者が実行すると成功する (204)
    response = await client.post(
        f"/api/v1/attendance/{emp.id}/alerts/acknowledge",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 204

    # DBにレコードが追加されていることを検証
    stmt = select(AttendanceAlertAcknowledgment).where(
        AttendanceAlertAcknowledgment.user_id == emp.id,
        AttendanceAlertAcknowledgment.date == date(2026, 5, 15),
        AttendanceAlertAcknowledgment.rule_id == "test_rule"
    )
    result = await session.execute(stmt)
    ack = result.scalar_one_or_none()
    assert ack is not None
    assert ack.acknowledged_by_user_id == admin.id

    # 2. アラートの確認を解除するテスト
    response = await client.request(
        "DELETE",
        f"/api/v1/attendance/{emp.id}/alerts/acknowledge",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 204

    # DBからレコードが削除されていることを検証
    result = await session.execute(stmt)
    ack = result.scalar_one_or_none()
    assert ack is None
