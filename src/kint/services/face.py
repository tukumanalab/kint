"""顔認証打刻サービス。ディスクリプタの登録・照合・打刻トークン発行を行う。"""

import math
import struct
import uuid
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings as env_settings
from kint.exceptions import KintForbiddenError, KintNotFoundError, KintUnauthorizedError
from kint.models.face_descriptor import FaceDescriptor
from kint.models.user import User
from kint.schemas.face import FaceIdentifyResponse, FaceStatus
from kint.services.settings import SettingsService

_ALGORITHM = "HS256"
_DESCRIPTOR_DIM = 128
_AMBIGUOUS_MARGIN = 0.05
_FACE_MATCH_TOKEN_TYPE = "face_match"
_FACE_MATCH_TOKEN_EXPIRE_SECONDS = 60


def _encode_descriptor(values: list[float]) -> bytes:
    """128次元 float リストを float32 バイナリへエンコードする。"""
    return struct.pack(f"<{_DESCRIPTOR_DIM}f", *values)


def _decode_descriptor(data: bytes) -> list[float]:
    """float32 バイナリを 128次元 float リストへデコードする。"""
    return list(struct.unpack(f"<{_DESCRIPTOR_DIM}f", data))


def _euclidean_distance(a: list[float], b: list[float]) -> float:
    """2つの等長ベクトル間のユークリッド距離を返す。"""
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


class FaceService:
    """顔認証ディスクリプタの登録・照合・打刻トークン発行を担うサービス。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _get_user(self, user_id: str) -> User:
        """user_id からユーザーを返す。存在しない場合は KintNotFoundError。"""
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(code="USER_NOT_FOUND", message="ユーザーが見つかりません")
        return user

    async def get_status(self, user_id: str) -> FaceStatus:
        """指定ユーザーの顔データ登録状況（登録有無・件数・最終更新日時）を返す。"""
        result = await self.session.execute(
            select(FaceDescriptor).where(FaceDescriptor.user_id == user_id)
        )
        rows = result.scalars().all()
        updated_at = max((r.created_at for r in rows), default=None)
        return FaceStatus(registered=len(rows) > 0, count=len(rows), updated_at=updated_at)

    async def has_face_data_map(self, user_ids: list[str]) -> dict[str, bool]:
        """複数ユーザーについて顔データ登録有無をまとめて返す（ユーザー一覧画面向け）。"""
        if not user_ids:
            return {}
        result = await self.session.execute(
            select(FaceDescriptor.user_id).where(FaceDescriptor.user_id.in_(user_ids)).distinct()
        )
        registered_ids = {row[0] for row in result.all()}
        return {uid: uid in registered_ids for uid in user_ids}

    async def register_descriptors(
        self, user_id: str, descriptors: list[list[float]]
    ) -> FaceStatus:
        """指定ユーザーの顔ディスクリプタを置換登録する。管理者ユーザーへの登録は不可。"""
        user = await self._get_user(user_id)
        if user.role == "admin":
            raise KintForbiddenError(
                code="ADMIN_FACE_NOT_ALLOWED",
                message="管理者ユーザーは打刻対象外のため顔データを登録できません",
            )

        await self.session.execute(delete(FaceDescriptor).where(FaceDescriptor.user_id == user_id))
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        for values in descriptors:
            self.session.add(
                FaceDescriptor(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    descriptor=_encode_descriptor(values),
                    created_at=now,
                )
            )
        await self.session.commit()
        return await self.get_status(user_id)

    async def delete_descriptors(self, user_id: str) -> None:
        """指定ユーザーの顔ディスクリプタを全削除する。"""
        await self._get_user(user_id)
        await self.session.execute(delete(FaceDescriptor).where(FaceDescriptor.user_id == user_id))
        await self.session.commit()

    def _create_face_match_token(self, user_id: str) -> str:
        """短命（60秒）の顔認証打刻トークン (JWT) を発行する。"""
        now = datetime.now(tz=UTC)
        payload = {
            "sub": user_id,
            "type": _FACE_MATCH_TOKEN_TYPE,
            "exp": now + timedelta(seconds=_FACE_MATCH_TOKEN_EXPIRE_SECONDS),
        }
        return jwt.encode(payload, env_settings.secret_key, algorithm=_ALGORITHM)

    @staticmethod
    def verify_face_match_token(token: str) -> str:
        """顔認証打刻トークンを検証し user_id を返す。無効・期限切れなら KintUnauthorizedError。"""
        try:
            payload = jwt.decode(token, env_settings.secret_key, algorithms=[_ALGORITHM])
        except JWTError:
            raise KintUnauthorizedError(
                code="FACE_MATCH_TOKEN_INVALID", message="顔認証トークンが無効です"
            )
        user_id = payload.get("sub")
        if payload.get("type") != _FACE_MATCH_TOKEN_TYPE or not user_id:
            raise KintUnauthorizedError(
                code="FACE_MATCH_TOKEN_INVALID", message="顔認証トークンが無効です"
            )
        return user_id

    async def identify(self, descriptor: list[float], now: datetime) -> FaceIdentifyResponse:
        """顔ディスクリプタから最も一致するユーザーを照合し、一致すれば打刻トークンを発行する。"""
        from kint.services.attendance import PunchService  # 循環 import を避けるため遅延 import

        settings_svc = SettingsService(self.session)
        threshold_shift = await settings_svc.get_float("face_match_threshold")
        threshold_no_shift = await settings_svc.get_float("face_match_threshold_no_shift")

        result = await self.session.execute(
            select(FaceDescriptor, User)
            .join(User, FaceDescriptor.user_id == User.id)
            .where(User.is_active == 1, User.role != "admin")
        )
        rows = result.all()

        best_per_user: dict[str, float] = {}
        user_map: dict[str, User] = {}
        for fd, user in rows:
            vec = _decode_descriptor(fd.descriptor)
            dist = _euclidean_distance(vec, descriptor)
            user_map[user.id] = user
            if user.id not in best_per_user or dist < best_per_user[user.id]:
                best_per_user[user.id] = dist

        no_match = FaceIdentifyResponse(
            matched=False,
            user_id=None,
            user_name=None,
            distance=None,
            has_shift=False,
            requires_confirmation=False,
            face_match_token=None,
            greeting_kind=None,
        )
        if not best_per_user:
            return no_match

        ranked = sorted(best_per_user.items(), key=lambda kv: kv[1])
        best_user_id, best_dist = ranked[0]
        second_dist = ranked[1][1] if len(ranked) > 1 else None

        punch_svc = PunchService(self.session)
        has_shift = await punch_svc._has_shift_for_check_in(best_user_id, now)
        open_attendance = await punch_svc._get_open_attendance(best_user_id)
        # 打刻処理と同様、24時間を超えて放置された未退勤レコードは退勤対象として扱わない
        if open_attendance is not None and (
            open_attendance.check_in is None
            or (now - punch_svc._as_utc(open_attendance.check_in)).total_seconds() > 24 * 3600
        ):
            open_attendance = None
        on_shift_like = has_shift or open_attendance is not None

        threshold = threshold_shift if on_shift_like else threshold_no_shift
        ambiguous = second_dist is not None and (second_dist - best_dist) < _AMBIGUOUS_MARGIN

        if best_dist > threshold or ambiguous:
            return FaceIdentifyResponse(
                matched=False,
                user_id=None,
                user_name=None,
                distance=round(best_dist, 4),
                has_shift=on_shift_like,
                requires_confirmation=False,
                face_match_token=None,
                greeting_kind=None,
            )

        user = user_map[best_user_id]
        greeting_kind = "check_out" if open_attendance is not None else "check_in"
        token = self._create_face_match_token(best_user_id)

        return FaceIdentifyResponse(
            matched=True,
            user_id=user.id,
            user_name=user.name,
            distance=round(best_dist, 4),
            has_shift=on_shift_like,
            requires_confirmation=not on_shift_like,
            face_match_token=token,
            greeting_kind=greeting_kind,
        )
