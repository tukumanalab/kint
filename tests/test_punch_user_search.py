from httpx import AsyncClient


async def _create_user(session, **kwargs) -> object:
    """テスト用ユーザーを DB に作成する。"""
    from kint.models.user import User

    defaults = {
        "id": "user-001",
        "name": "taro",
        "full_name": "山田 太郎",
        "email": "taro@example.com",
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


class TestSearchPunchUsers:
    async def test_search_by_partial_full_name_returns_active_candidates(
        self, client: AsyncClient, session: object
    ) -> None:
        """氏名の部分一致でアクティブユーザー候補を返す。"""
        await _create_user(session)
        await _create_user(
            session,
            id="user-002",
            name="hanako",
            full_name="山田 花子",
            email="hanako@example.com",
        )
        await _create_user(
            session,
            id="user-003",
            name="jiro",
            full_name="佐藤 次郎",
            email="jiro@example.com",
            is_active=0,
        )

        resp = await client.get("/api/v1/punches/users", params={"q": "山田"})

        assert resp.status_code == 200
        data = resp.json()
        assert [user["id"] for user in data["users"]] == ["user-001", "user-002"]
        assert data["users"][0] == {
            "id": "user-001",
            "name": "taro",
            "full_name": "山田 太郎",
        }

    async def test_search_by_partial_display_name_returns_candidates(
        self, client: AsyncClient, session: object
    ) -> None:
        """表示名の部分一致で候補を返す。"""
        await _create_user(session)

        resp = await client.get("/api/v1/punches/users", params={"q": "tar"})

        assert resp.status_code == 200
        assert resp.json()["users"][0]["id"] == "user-001"

    async def test_search_without_query_returns_422(self, client: AsyncClient) -> None:
        """検索語がない場合は 422 を返す。"""
        resp = await client.get("/api/v1/punches/users")

        assert resp.status_code == 422
