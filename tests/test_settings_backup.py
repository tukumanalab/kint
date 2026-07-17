import pytest
from httpx import AsyncClient
from sqlalchemy import select

from kint.models.user import User

pytestmark = pytest.mark.asyncio


async def _create_user(session, **kwargs) -> User:
    from kint.models.user import User

    defaults = {
        "id": "testuser",
        "name": "テストユーザー",
        "full_name": "Test User",
        "email": "test@example.com",
        "role": "employee",
        "is_active": 1,
        "token_version": 1,
    }
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _login(account_id: str) -> str:
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


async def test_database_backup_restore_permissions(client: AsyncClient, session) -> None:
    # 1. 一般ユーザー（employee）でアクセスして 403 Forbidden になることを確認
    await _create_user(session, id="normal", email="normal@example.com", role="employee")
    token = await _login("normal")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/v1/settings/database/backup", headers=headers)
    assert resp.status_code == 403

    resp = await client.post(
        "/api/v1/settings/database/restore", headers=headers, files={"file": ("dummy.db", b"dummy")}
    )
    assert resp.status_code == 403


async def test_database_backup_and_restore_flow(client: AsyncClient, session) -> None:
    # 1. 管理者（admin）でログイン
    await _create_user(session, id="admin", email="admin@example.com", role="admin")
    token = await _login("admin")
    headers = {"Authorization": f"Bearer {token}"}

    # 2. データベースバックアップをダウンロード
    resp = await client.get("/api/v1/settings/database/backup", headers=headers)
    assert resp.status_code == 200
    db_content = resp.content
    assert len(db_content) > 0

    # 3. データベースに別のユーザー（追加データ）を挿入
    new_user = User(
        id="new_user",
        name="追加ユーザー",
        full_name="Added User",
        email="added@example.com",
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(new_user)
    await session.commit()

    # 4. 追加ユーザーが存在することを確認
    stmt = select(User).where(User.id == "new_user")
    res = await session.execute(stmt)
    assert res.scalar_one_or_none() is not None

    # 5. バックアップファイルをアップロードして復元を実行
    files = {"file": ("backup.db", db_content, "application/x-sqlite3")}
    resp = await client.post("/api/v1/settings/database/restore", headers=headers, files=files)
    assert resp.status_code == 200, f"Restore failed: {resp.status_code} - {resp.text}"
    assert resp.json() == {"message": "データベースを正常に復元しました"}

    # 6. 復元後、追加されたユーザーが消えている（元通りになっている）ことを確認
    # セッション内のオブジェクトをクリアするために expire_all などを行うか、あるいは新しいトランザクション/セッションを想定
    session.expire_all()
    stmt = select(User).where(User.id == "new_user")
    res = await session.execute(stmt)
    assert res.scalar_one_or_none() is None
