"""エラーレスポンススキーマ。"""

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """API エラーレスポンス。code / message / detail 形式。"""

    code: str
    message: str
    detail: dict | None = None
