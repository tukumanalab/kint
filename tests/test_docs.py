"""ドキュメント API のテスト。"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.user import User
from kint.routers.auth import _create_access_token


@pytest.fixture
async def sample_user(session: AsyncSession) -> User:
    """一般ユーザー作成フィクスチャ。"""
    user = User(
        id="usr_docs_test",
        name="docuser",
        full_name="Doc User",
        email="docuser@example.com",
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_get_attendance_guide_unauthorized(client: AsyncClient):
    """未認証の場合 401 が返る。"""
    res = await client.get("/api/v1/docs/attendance-guide")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_attendance_guide_success(client: AsyncClient, sample_user: User):
    """認証済みユーザーが勤怠ガイドを取得できる。"""
    token = _create_access_token(sample_user.id, sample_user.token_version)
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.get("/api/v1/docs/attendance-guide", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "勤怠一覧画面 使い方ガイド"
    assert "# 勤怠一覧画面 使い方ガイド" in data["content"]
    assert "修正申請" in data["content"]
