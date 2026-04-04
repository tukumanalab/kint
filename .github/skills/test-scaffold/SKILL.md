---
name: test-scaffold
description: "テストコードの雛形作成と実行。Use when writing pytest tests, creating test fixtures, mocking dependencies, or validating API endpoints for the attendance system."
argument-hint: "テスト対象のモジュールや機能を記述してください"
---

# テスト スキャフォールド

## いつ使うか
- 新しいテストファイルの作成
- テストフィクスチャのセットアップ
- API エンドポイントのテスト
- サービス層の単体テスト

## テスト実行

```bash
# 全テスト実行
pytest tests/ -v

# 特定ファイル
pytest tests/test_attendance.py -v

# カバレッジ付き
pytest tests/ --cov=src/kint --cov-report=html
```

## conftest.py テンプレート

```python
# tests/conftest.py
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from kint.main import app
from kint.db import Base, get_session

TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

@pytest.fixture
async def engine():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture
async def session(engine):
    async with AsyncSession(engine) as session:
        yield session

@pytest.fixture
async def client(session):
    async def override_get_session():
        yield session
    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
    app.dependency_overrides.clear()
```

## APIテストテンプレート

```python
# tests/test_attendance.py
import pytest

@pytest.mark.asyncio
async def test_check_in(client):
    """チェックインが正常に動作する。"""
    response = await client.post(
        "/api/attendance/check-in",
        json={"card_idm": "0123456789ABCDEF"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "checked_in"

@pytest.mark.asyncio
async def test_check_in_unknown_card(client):
    """未登録カードでチェックインするとエラーになる。"""
    response = await client.post(
        "/api/attendance/check-in",
        json={"card_idm": "0000000000000000"},
    )
    assert response.status_code == 404
```

## サービステストテンプレート

```python
@pytest.mark.asyncio
async def test_attendance_service_check_in(session):
    """サービス層のチェックインロジック。"""
    # Arrange
    service = AttendanceService(session)
    # ... セットアップ

    # Act
    result = await service.check_in("0123456789ABCDEF")

    # Assert
    assert result.check_in is not None
    assert result.check_out is None
```
