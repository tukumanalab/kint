import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from kint.models.card import Card
from kint.models.user import User


async def _create_user(session, **kwargs) -> User:
    """テスト用ユーザーを DB に作成する。"""
    defaults = {
        "id": "testadmin",
        "name": "管理者",
        "full_name": "Test Admin",
        "email": "admin@example.com",
        "role": "admin",
        "is_active": 1,
        "token_version": 1,
    }
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _login(
    client: AsyncClient, account_id: str = "testadmin", password: str = "Password1"
) -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token
    return _create_access_token(account_id, 1)


class TestUserBackup:
    async def test_export_and_import_success(self, client: AsyncClient, session) -> None:
        """一括エクスポートと、全員が正常な一括インポート（UPSERT / カード同期）が動作すること。"""
        # 管理者作成 & ログイン
        admin = await _create_user(session)
        token = await _login(client)

        # 別の従業員ユーザーと紐づくカードを作成
        await _create_user(
            session,
            id="emp1",
            name="従業員1",
            full_name="Emp One",
            email="emp1@example.com",
            role="employee",
        )
        card1 = Card(
            id=str(uuid.uuid4()),
            user_id="emp1",
            card_idm="0123456789abcdef",
            name="Suica",
            is_active=1,
        )
        session.add(card1)
        await session.commit()

        headers = {"Authorization": f"Bearer {token}"}

        # 1. エクスポートを実行
        resp_export = await client.get("/api/v1/users/export", headers=headers)
        assert resp_export.status_code == 200
        export_data = resp_export.json()

        # テスト管理者と従業員1がいるはず
        assert len(export_data) == 2
        emp_export = next(u for u in export_data if u["id"] == "emp1")
        assert emp_export["name"] == "従業員1"
        assert emp_export["email"] == "emp1@example.com"
        assert len(emp_export["cards"]) == 1
        assert emp_export["cards"][0]["card_idm"] == "0123456789abcdef"

        # 2. インポートを実行
        # emp1 の表示名変更、不要なカード削除 + 新規カード、新規ユーザー emp2 追加
        import_payload = [
            {
                "id": "testadmin",
                "name": "管理者改",
                "full_name": "Test Admin Modified",
                "email": "admin@example.com",
                "role": "admin",
                "is_active": True,
                "cards": [],
            },
            {
                "id": "emp1",
                "name": "従業員1改",
                "full_name": "Emp One Modified",
                "email": "emp1@example.com",
                "role": "employee",
                "is_active": True,
                "cards": [
                    {"card_idm": "fedcba9876543210", "name": "Pasmo", "is_active": True}
                ],
            },
            {
                "id": "emp2",
                "name": "従業員2",
                "full_name": "Emp Two",
                "email": "emp2@example.com",
                "role": "employee",
                "is_active": True,
                "cards": [],
            },
        ]

        resp_import = await client.post(
            "/api/v1/users/import", headers=headers, json=import_payload
        )
        assert resp_import.status_code == 200
        import_result = resp_import.json()
        assert import_result["imported_count"] == 1  # emp2
        assert import_result["updated_count"] == 2  # testadmin, emp1
        assert import_result["failed_count"] == 0
        assert len(import_result["errors"]) == 0

        # セッションのキャッシュをクリアしてDBから新鮮なデータを再取得させる
        session.expire_all()

        # DBの状態を確認
        # emp1 のカードが置換されている（古いカードは物理削除されている）
        res_emp1 = await session.execute(
            select(User).where(User.id == "emp1").options(selectinload(User.cards))
        )
        u1 = res_emp1.scalar_one()
        assert u1.name == "従業員1改"
        assert len(u1.cards) == 1
        assert u1.cards[0].card_idm == "fedcba9876543210"
        assert u1.cards[0].name == "Pasmo"

        res_old_card = await session.execute(
            select(Card).where(Card.card_idm == "0123456789abcdef")
        )
        assert res_old_card.scalar_one_or_none() is None

        # emp2 が作成されていること
        res_emp2 = await session.execute(select(User).where(User.id == "emp2"))
        assert res_emp2.scalar_one_or_none() is not None

    async def test_import_partial_failure_skips_failed_users(
        self, client: AsyncClient, session
    ) -> None:
        """エラーユーザーのみスキップしてインポートが処理されること。"""
        # 管理者作成 & ログイン
        await _create_user(session)
        token = await _login(client)
        headers = {"Authorization": f"Bearer {token}"}

        # 既存の別従業員
        await _create_user(
            session,
            id="emp_existing",
            name="従業員A",
            full_name="Emp A",
            email="existing_email@example.com",
        )

        # インポートするデータ
        # 1. 正常な新規
        # 2. メールアドレス重複 (emp_existingのメールと重複) -> スキップ
        # 3. 正常な更新
        import_payload = [
            {
                "id": "new_ok",
                "name": "新規OK",
                "full_name": "New Ok",
                "email": "newok@example.com",
                "role": "employee",
                "is_active": True,
                "cards": [],
            },
            {
                "id": "fail_dup_email",
                "name": "失敗重複メール",
                "full_name": "Fail Email",
                "email": "existing_email@example.com",  # 重複
                "role": "employee",
                "is_active": True,
                "cards": [],
            },
            {
                "id": "testadmin",
                "name": "管理者更新",
                "full_name": "Test Admin",
                "email": "admin@example.com",
                "role": "admin",
                "is_active": True,
                "cards": [],
            },
        ]

        resp_import = await client.post(
            "/api/v1/users/import", headers=headers, json=import_payload
        )
        assert resp_import.status_code == 200
        res = resp_import.json()
        assert res["imported_count"] == 1  # new_ok
        assert res["updated_count"] == 1  # testadmin
        assert res["failed_count"] == 1  # fail_dup_email
        assert len(res["errors"]) == 1
        assert res["errors"][0]["id"] == "fail_dup_email"
        assert res["errors"][0]["code"] == "EMAIL_CONFLICT"

        # セッションのキャッシュをクリアしてDBから新鮮なデータを再取得させる
        session.expire_all()

        # DB確認
        # new_ok は作成されている
        res_new = await session.execute(select(User).where(User.id == "new_ok"))
        assert res_new.scalar_one_or_none() is not None

        # fail_dup_email は作成されていない
        res_fail = await session.execute(select(User).where(User.id == "fail_dup_email"))
        assert res_fail.scalar_one_or_none() is None

        # testadmin は更新されている
        res_admin = await session.execute(select(User).where(User.id == "testadmin"))
        u_admin = res_admin.scalar_one()
        assert u_admin.name == "管理者更新"

    async def test_permission_denied_for_employees(self, client: AsyncClient, session) -> None:
        """一般従業員はエクスポート、インポートの実行権限がないこと。"""
        # 一般従業員作成 & ログイン
        await _create_user(session, id="emp_user", role="employee")
        token = await _login(client, account_id="emp_user")
        headers = {"Authorization": f"Bearer {token}"}

        # エクスポート
        resp_export = await client.get("/api/v1/users/export", headers=headers)
        assert resp_export.status_code == 403

        # インポート
        resp_import = await client.post("/api/v1/users/import", headers=headers, json=[])
        assert resp_import.status_code == 403

    async def test_unauthenticated(self, client: AsyncClient) -> None:
        """未認証アクセスは 401 が返ること。"""
        resp_export = await client.get("/api/v1/users/export")
        assert resp_export.status_code == 401

        resp_import = await client.post("/api/v1/users/import", json=[])
        assert resp_import.status_code == 401
