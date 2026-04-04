---
name: api-scaffold
description: "新しいAPIエンドポイントの雛形作成。Use when creating new REST API endpoints, adding routes, defining Pydantic schemas, or scaffolding FastAPI router files."
argument-hint: "エンドポイントの目的を記述してください（例: ユーザー一覧取得API）"
---

# APIエンドポイント スキャフォールド

## いつ使うか
- 新しいAPIエンドポイントの追加
- 新しいルーターファイルの作成
- CRUD操作の一括作成

## 手順

1. **スキーマ定義**: `src/kint/schemas/` に Pydantic モデルを作成
2. **サービス実装**: `src/kint/services/` にビジネスロジックを実装
3. **ルーター作成**: `src/kint/routers/` にエンドポイントを定義
4. **ルーター登録**: `src/kint/main.py` にルーターを追加
5. **テスト作成**: `tests/` にテストを追加

## スキーマテンプレート

```python
# src/kint/schemas/example.py
from datetime import datetime
from pydantic import BaseModel

class ExampleCreate(BaseModel):
    """作成リクエスト。"""
    name: str

class ExampleResponse(BaseModel):
    """レスポンス。"""
    id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}
```

## サービステンプレート

```python
# src/kint/services/example.py
from sqlalchemy.ext.asyncio import AsyncSession
from kint.models.example import Example
from kint.schemas.example import ExampleCreate

class ExampleService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, data: ExampleCreate) -> Example:
        """新規作成。"""
        obj = Example(**data.model_dump())
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj
```

## ルーターテンプレート

```python
# src/kint/routers/example.py
from fastapi import APIRouter, Depends
from kint.schemas.example import ExampleCreate, ExampleResponse
from kint.services.example import ExampleService
from kint.db import get_session

router = APIRouter(prefix="/example", tags=["example"])

@router.post("/", response_model=ExampleResponse, status_code=201)
async def create_example(
    data: ExampleCreate,
    service: ExampleService = Depends(),
) -> ExampleResponse:
    """新規作成エンドポイント。"""
    return await service.create(data)
```
