"""ドキュメント参照用 API ルーター。"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from kint.exceptions import KintNotFoundError
from kint.models.user import User
from kint.routers.auth import get_current_user

router = APIRouter(prefix="/docs", tags=["docs"])

# プロジェクトルートの docs ディレクトリ配下のパス
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ATTENDANCE_GUIDE_PATH = _PROJECT_ROOT / "docs" / "attendance_guide.md"


class GuideDocResponse(BaseModel):
    """ガイドドキュメントレスポンス。"""

    title: str
    content: str


@router.get("/attendance-guide", response_model=GuideDocResponse)
async def get_attendance_guide(
    _current_user: Annotated[User, Depends(get_current_user)],
) -> GuideDocResponse:
    """勤怠一覧画面の使い方ガイド (docs/attendance_guide.md) の内容を取得する。"""
    if not _ATTENDANCE_GUIDE_PATH.exists():
        raise KintNotFoundError(
            code="DOC_NOT_FOUND",
            message="使い方ガイドドキュメントが見つかりません。",
        )

    content = _ATTENDANCE_GUIDE_PATH.read_text(encoding="utf-8")
    return GuideDocResponse(
        title="勤怠一覧画面 使い方ガイド",
        content=content,
    )
