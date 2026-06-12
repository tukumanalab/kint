import pytest
from httpx import AsyncClient

from kint.models.user import User


async def _create_user(session, **kwargs) -> User:
    """テスト用ユーザーを DB に作成する。"""
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


async def _login(client: AsyncClient, account_id: str) -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


class TestAdminUserCard:
    async def test_admin_manage_user_cards(self, client: AsyncClient, session: object) -> None:
        """管理者が他のユーザーのカードを取得、登録、名前変更、削除できること。"""
        # 管理者と一般従業員を作成
        admin = await _create_user(session, id="adminuser", role="admin", email="admin@example.com")
        employee = await _create_user(session, id="empuser", role="employee", email="emp@example.com")

        admin_token = await _login(client, "adminuser")

        # 1. 最初はカードがない
        resp = await client.get(
            f"/api/v1/users/{employee.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == []

        # 2. カードを登録する
        resp = await client.post(
            f"/api/v1/users/{employee.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"card_idm": "0123456789ABCDEF", "name": "会社ID"},
        )
        assert resp.status_code == 201
        card_data = resp.json()
        assert card_data["card_idm"] == "0123456789ABCDEF"
        assert card_data["name"] == "会社ID"
        card_id = card_data["card_id"]

        # 3. カード一覧を取得して確認
        resp = await client.get(
            f"/api/v1/users/{employee.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        cards = resp.json()
        assert len(cards) == 1
        assert cards[0]["card_id"] == card_id
        assert cards[0]["card_idm"] == "0123456789ABCDEF"

        # 4. カード名を変更する
        resp = await client.patch(
            f"/api/v1/users/{employee.id}/cards/{card_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "新しいカード名"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新しいカード名"

        # 5. カードを削除する
        resp = await client.delete(
            f"/api/v1/users/{employee.id}/cards/{card_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 204

        # 6. カード削除後に一覧が空になる
        resp = await client.get(
            f"/api/v1/users/{employee.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_non_admin_cannot_manage_user_cards(self, client: AsyncClient, session: object) -> None:
        """一般従業員は他人のカードを管理できないこと（403 Forbidden）。"""
        emp1 = await _create_user(session, id="emp1", role="employee", email="emp1@example.com")
        emp2 = await _create_user(session, id="emp2", role="employee", email="emp2@example.com")

        emp1_token = await _login(client, "emp1")

        # GET 403
        resp = await client.get(
            f"/api/v1/users/{emp2.id}/cards",
            headers={"Authorization": f"Bearer {emp1_token}"},
        )
        assert resp.status_code == 403

        # POST 403
        resp = await client.post(
            f"/api/v1/users/{emp2.id}/cards",
            headers={"Authorization": f"Bearer {emp1_token}"},
            json={"card_idm": "1111222233334444"},
        )
        assert resp.status_code == 403

        # PATCH 403
        resp = await client.patch(
            f"/api/v1/users/{emp2.id}/cards/some-card-id",
            headers={"Authorization": f"Bearer {emp1_token}"},
            json={"name": "hoge"},
        )
        assert resp.status_code == 403

        # DELETE 403
        resp = await client.delete(
            f"/api/v1/users/{emp2.id}/cards/some-card-id",
            headers={"Authorization": f"Bearer {emp1_token}"},
        )
        assert resp.status_code == 403

    async def test_admin_manage_nonexistent_user(self, client: AsyncClient, session: object) -> None:
        """存在しないユーザーに対する操作は404エラーになること。"""
        await _create_user(session, id="adminuser", role="admin", email="admin@example.com")
        admin_token = await _login(client, "adminuser")

        resp = await client.get(
            "/api/v1/users/nonexistent/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 404

        resp = await client.post(
            "/api/v1/users/nonexistent/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"card_idm": "1111222233334444"},
        )
        assert resp.status_code == 404

    async def test_admin_register_duplicate_card_idm(self, client: AsyncClient, session: object) -> None:
        """重複したカードIDmの登録は409エラーになること。"""
        await _create_user(session, id="adminuser", role="admin", email="admin@example.com")
        emp1 = await _create_user(session, id="emp1", role="employee", email="emp1@example.com")
        emp2 = await _create_user(session, id="emp2", role="employee", email="emp2@example.com")

        admin_token = await _login(client, "adminuser")

        # emp1 にカード登録
        resp = await client.post(
            f"/api/v1/users/{emp1.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"card_idm": "1111222233334444", "name": "card1"},
        )
        assert resp.status_code == 201

        # emp2 に同じカード登録
        resp = await client.post(
            f"/api/v1/users/{emp2.id}/cards",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"card_idm": "1111222233334444", "name": "card2"},
        )
        assert resp.status_code == 409
