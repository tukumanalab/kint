"""顔認証打刻スキーマ。"""

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

_DESCRIPTOR_DIM = 128


def _validate_descriptor_values(values: list[float]) -> list[float]:
    """ディスクリプタが 128 次元かつ全要素が有限数値であることを検証する。"""
    if len(values) != _DESCRIPTOR_DIM:
        raise ValueError(f"descriptor は {_DESCRIPTOR_DIM} 要素である必要があります")
    for v in values:
        if not math.isfinite(v):
            raise ValueError("descriptor の要素は有限の数値である必要があります")
    return values


class FaceStatus(BaseModel):
    """顔データ登録状況。"""

    registered: bool
    count: int
    updated_at: datetime | None = None


class FaceDescriptorIn(BaseModel):
    """顔ディスクリプタ登録リクエスト。1〜5件、各128次元。"""

    descriptors: list[list[float]]

    @field_validator("descriptors")
    @classmethod
    def validate_descriptors(cls, v: list[list[float]]) -> list[list[float]]:
        """1〜5件、各要素が128次元の有限数値であることを検証する。"""
        if not 1 <= len(v) <= 5:
            raise ValueError("descriptors は 1〜5 件で指定してください")
        return [_validate_descriptor_values(d) for d in v]


class FaceIdentifyRequest(BaseModel):
    """顔識別リクエスト。"""

    descriptor: list[float]

    @field_validator("descriptor")
    @classmethod
    def validate_descriptor(cls, v: list[float]) -> list[float]:
        """128次元の有限数値であることを検証する。"""
        return _validate_descriptor_values(v)


class FaceIdentifyResponse(BaseModel):
    """顔識別レスポンス。"""

    matched: bool
    user_id: str | None = None
    user_name: str | None = None
    distance: float | None = None
    has_shift: bool
    requires_confirmation: bool
    face_match_token: str | None = None
    greeting_kind: Literal["check_in", "check_out"] | None = None


class FacePunchConfig(BaseModel):
    """顔認証打刻設定（キオスク端末向け）。"""

    enabled: bool
    countdown_seconds: int
    cooldown_seconds: int
