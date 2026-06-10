"""打刻端末サービスクラス。端末登録（デバイストークン生成）と検証を行う。"""

from jose import JWTError, jwt

from kint.config import settings
from kint.schemas.punch_device import PunchDeviceTokenResponse, PunchDeviceVerifyResponse

_ALGORITHM = "HS256"


class PunchDeviceService:
    """データベースを使わずにJWTトークンを用いた打刻端末の管理を提供するサービス。"""

    @staticmethod
    def create_device_token(name: str) -> PunchDeviceTokenResponse:
        """指定された端末名のデバイストークン(JWT)を生成して返す。"""
        payload = {
            "sub": "punch_device",
            "name": name,
            "type": "device_punch",
        }
        # 期限切れにならない長期トークンとして発行（expを含めない）
        token = jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)
        return PunchDeviceTokenResponse(device_token=token, name=name)

    @staticmethod
    def verify_device_token(token: str) -> PunchDeviceVerifyResponse:
        """デバイストークンが有効か検証する。"""
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
            if payload.get("sub") == "punch_device" and payload.get("type") == "device_punch":
                return PunchDeviceVerifyResponse(valid=True, name=payload.get("name"))
        except JWTError:
            pass
        return PunchDeviceVerifyResponse(valid=False, name=None)
