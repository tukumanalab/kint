"""データベース接続・セッション管理。"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from kint.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """全テーブルの基底クラス。"""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI の Depends で使用する DB セッション依存関数。"""
    async with AsyncSessionLocal() as session:
        yield session
