"""カード登録スキーマ。"""

from pydantic import BaseModel


class CardRegistrationRequest(BaseModel):
    """カード登録リクエスト。"""

    user_id: str
    card_idm: str


class CardRegistrationResponse(BaseModel):
    """カード登録レスポンス。"""

    card_id: str
    user_id: str
    card_idm: str
    is_active: bool

    model_config = {"from_attributes": True}
