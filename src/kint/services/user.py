"""ユーザー管理サービス。"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from kint.config import settings
from kint.exceptions import (
    KintBadGatewayError,
    KintBadRequestError,
    KintConflictError,
    KintNotFoundError,
    KintUnauthorizedError,
)
from kint.models.card import Card
from kint.models.email_verification import EmailVerificationRequest
from kint.models.user import User
from kint.models.user_profile_change_log import UserProfileChangeLog
from kint.schemas.punch import PunchUserCandidate, PunchUserCandidateListResponse
from kint.schemas.user import (
    EmailChangeAcceptedResponse,
    EmailChangeRequestCreate,
    EmailVerificationConfirmResponse,
    MeCardListItem,
    MeCardPatchRequest,
    MeCardRegistrationRequest,
    MeCardRegistrationResponse,
    MeProfileUpdateRequest,
    UserCreateRequest,
    UserPatchRequest,
    UserResponse,
    UsersListResponse,
)
from kint.schemas.user_backup import CardBackupSchema, ImportErrorItem, UserBackupSchema
from kint.services.gmail import GmailAdapter

_MIN_ACTIVE_ADMINS = 1


def _hash_password(plain: str) -> str:
    """bcrypt でパスワードをハッシュ化する。"""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


async def _count_active_admins(session: AsyncSession, exclude_user_id: str | None = None) -> int:
    """有効な admin の件数を返す。exclude_user_id を指定するとその1件を除外する。"""
    query = select(func.count()).where(User.role == "admin", User.is_active == 1)
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    result = await session.execute(query)
    return result.scalar_one()


class UserService:
    """ユーザー管理サービス。登録・修正・論理削除を処理する。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_users(self) -> UsersListResponse:
        """ユーザー一覧を返す。"""
        result = await self.session.execute(select(User).order_by(User.created_at))
        users = result.scalars().all()
        return UsersListResponse(users=[UserResponse.model_validate(u) for u in users])

    async def search_punch_candidates(
        self, query: str, limit: int = 10
    ) -> PunchUserCandidateListResponse:
        """カード忘れ打刻で使う公開ユーザー候補を返す。"""
        normalized = query.strip()
        if not normalized:
            return PunchUserCandidateListResponse(users=[])

        pattern = f"%{normalized}%"
        result = await self.session.execute(
            select(User)
            .where(
                User.is_active == 1,
                or_(
                    User.id.ilike(pattern),
                    User.name.ilike(pattern),
                    User.full_name.ilike(pattern),
                ),
            )
            .order_by(User.full_name, User.name, User.id)
            .limit(limit)
        )
        users = result.scalars().all()
        return PunchUserCandidateListResponse(
            users=[PunchUserCandidate.model_validate(user) for user in users]
        )

    async def create_user(self, data: UserCreateRequest) -> UserResponse:
        """ユーザーを新規作成する。アカウントID・メール重複時は KintConflictError。"""
        id_existing = await self.session.execute(select(User.id).where(User.id == data.id))
        if id_existing.scalar_one_or_none() is not None:
            raise KintConflictError(
                code="ACCOUNT_ID_CONFLICT",
                message=f"アカウントID '{data.id}' はすでに使用されています",
                detail={"id": data.id},
            )

        existing = await self.session.execute(select(User.id).where(User.email == data.email))
        if existing.scalar_one_or_none() is not None:
            raise KintConflictError(
                code="EMAIL_CONFLICT",
                message=f"メールアドレス '{data.email}' はすでに使用されています",
                detail={"email": data.email},
            )

        user = User(
            id=data.id,
            name=data.name,
            full_name=data.full_name,
            email=data.email,
            password_hash=None,
            role=data.role,
            is_active=1,
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return UserResponse.model_validate(user)

    async def patch_user(self, user_id: str, data: UserPatchRequest) -> UserResponse:
        """ユーザー情報を更新する。メール重複・最後のadmin無効化は KintConflictError。"""
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザー '{user_id}' が見つかりません",
            )

        # email 重複チェック
        if data.email is not None and data.email != user.email:
            dup = await self.session.execute(
                select(User.id).where(User.email == data.email, User.id != user_id)
            )
            if dup.scalar_one_or_none() is not None:
                raise KintConflictError(
                    code="EMAIL_CONFLICT",
                    message=f"メールアドレス '{data.email}' はすでに使用されています",
                    detail={"email": data.email},
                )

        # 最後の有効な admin を無効化しようとした場合はエラー
        deactivating = data.is_active is False and user.is_active == 1
        demoting = data.role is not None and data.role != "admin" and user.role == "admin"
        if (deactivating or demoting) and user.role == "admin":
            remaining = await _count_active_admins(self.session, exclude_user_id=user_id)
            if remaining < _MIN_ACTIVE_ADMINS:
                raise KintConflictError(
                    code="LAST_ADMIN",
                    message="最後の有効な管理者を無効化またはロール変更することはできません",
                )

        if data.name is not None:
            user.name = data.name
        if data.full_name is not None:
            user.full_name = data.full_name
        if data.email is not None:
            user.email = data.email
        if data.role is not None:
            user.role = data.role
        if data.is_active is not None:
            user.is_active = 1 if data.is_active else 0

        await self.session.commit()
        await self.session.refresh(user)
        return UserResponse.model_validate(user)

    async def delete_user(self, user_id: str) -> bool:
        """ユーザーを論理削除する。既に無効なら冪等に True を返す。
        最後の有効な admin の削除は KintConflictError。
        存在しないユーザーは KintNotFoundError。
        戻り値は「既に無効だったか否か」にかかわらず True（204 用）。"""
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザー '{user_id}' が見つかりません",
            )

        # 既に無効 → 冪等
        if user.is_active == 0:
            return True

        # 最後の有効な admin は削除不可
        if user.role == "admin":
            remaining = await _count_active_admins(self.session, exclude_user_id=user_id)
            if remaining < _MIN_ACTIVE_ADMINS:
                raise KintConflictError(
                    code="LAST_ADMIN",
                    message="最後の有効な管理者を削除することはできません",
                )

        user.is_active = 0
        await self.session.commit()
        return True

    # ------------------------------------------------------------------
    # BE-09: マイページ API (本人プロフィール編集)
    # ------------------------------------------------------------------

    async def update_my_profile(
        self,
        current_user: User,
        data: MeProfileUpdateRequest,
    ) -> User:
        """本人の name / full_name を更新し、監査ログを保存する。"""
        before_name = current_user.name
        before_full_name = current_user.full_name

        if data.name is not None:
            current_user.name = data.name
        if data.full_name is not None:
            current_user.full_name = data.full_name

        log = UserProfileChangeLog(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="profile",
            before_name=before_name,
            after_name=current_user.name,
            before_full_name=before_full_name,
            after_full_name=current_user.full_name,
            reason="本人によるプロフィール更新",
        )
        self.session.add(log)
        await self.session.commit()
        await self.session.refresh(current_user)
        return current_user

    async def get_my_cards(
        self,
        current_user: User,
    ) -> list[MeCardListItem]:
        """本人に紐付く NFC カード一覧を返す。"""
        result = await self.session.execute(
            select(Card).where(Card.user_id == current_user.id).order_by(Card.created_at)
        )
        cards = result.scalars().all()
        return [
            MeCardListItem(
                card_id=card.id,
                card_idm=card.card_idm,
                name=card.name,
                is_active=bool(card.is_active),
                created_at=card.created_at,
            )
            for card in cards
        ]

    async def rename_my_card(
        self,
        current_user: User,
        card_id: str,
        data: MeCardPatchRequest,
    ) -> MeCardListItem:
        """カード名を変更する。他ユーザーまたは存在しない場合は KintNotFoundError。"""
        result = await self.session.execute(
            select(Card).where(Card.id == card_id, Card.user_id == current_user.id)
        )
        card = result.scalar_one_or_none()
        if card is None:
            raise KintNotFoundError(
                code="CARD_NOT_FOUND",
                message=f"カード '{card_id}' が見つかりません",
            )
        card.name = data.name
        await self.session.commit()
        await self.session.refresh(card)
        return MeCardListItem(
            card_id=card.id,
            card_idm=card.card_idm,
            name=card.name,
            is_active=bool(card.is_active),
            created_at=card.created_at,
        )

    async def delete_my_card(
        self,
        current_user: User,
        card_id: str,
    ) -> None:
        """本人の NFC カードを削除する。他ユーザーのカードまたは存在しない場合は
        KintNotFoundError。"""
        result = await self.session.execute(
            select(Card).where(Card.id == card_id, Card.user_id == current_user.id)
        )
        card = result.scalar_one_or_none()
        if card is None:
            raise KintNotFoundError(
                code="CARD_NOT_FOUND",
                message=f"カード '{card_id}' が見つかりません",
            )
        await self.session.delete(card)
        await self.session.commit()

    async def register_my_card(
        self,
        current_user: User,
        data: MeCardRegistrationRequest,
    ) -> MeCardRegistrationResponse:
        """本人の NFC カード (card_idm) を登録する。IDm 重複時は KintConflictError。"""
        dup = await self.session.execute(select(Card).where(Card.card_idm == data.card_idm))
        if dup.scalar_one_or_none() is not None:
            raise KintConflictError(
                code="CARD_IDM_CONFLICT",
                message=f"カード IDm '{data.card_idm}' はすでに登録されています",
                detail={"card_idm": data.card_idm},
            )

        card = Card(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            card_idm=data.card_idm,
            name=data.name,
            is_active=1,
        )
        self.session.add(card)
        await self.session.commit()
        await self.session.refresh(card)
        return MeCardRegistrationResponse(
            card_id=card.id,
            card_idm=card.card_idm,
            name=card.name,
            is_active=bool(card.is_active),
        )

    async def request_email_change(
        self,
        current_user: User,
        data: EmailChangeRequestCreate,
        gmail: GmailAdapter,
    ) -> EmailChangeAcceptedResponse:
        """new_email 宛に確認メールを送信し、EmailVerificationRequest を作成する。
        email 重複時は KintConflictError。Gmail 送信失敗時は KintBadGatewayError。
        """
        new_email = str(data.new_email)

        # 重複チェック（自分自身のメールアドレスも含めて重複扱い）
        dup = await self.session.execute(select(User.id).where(User.email == new_email))
        if dup.scalar_one_or_none() is not None:
            raise KintConflictError(
                code="EMAIL_CONFLICT",
                message=f"メールアドレス '{new_email}' はすでに使用されています",
                detail={"email": new_email},
            )

        # 未完了リクエストをキャンセル
        await self._cancel_pending_email_verification(current_user.id, "email_change")

        # トークン生成・ハッシュ化
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        expires_at = datetime.now(tz=UTC).replace(tzinfo=None) + timedelta(
            hours=settings.email_verification_expire_hours
        )

        evr = EmailVerificationRequest(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            requested_email=new_email,
            verification_type="email_change",
            token_hash=token_hash,
            requested_by_user_id=current_user.id,
            sent_via="gmail_api",
            expires_at=expires_at,
        )
        self.session.add(evr)

        # 監査ログ
        log = UserProfileChangeLog(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="email_change_requested",
            before_email=current_user.email,
            after_email=new_email,
            reason="本人によるメールアドレス変更リクエスト",
        )
        self.session.add(log)

        # Gmail 送信（失敗時はロールバック）
        try:
            gmail.send_email_verification(new_email, raw_token, "email_change")
        except KintBadGatewayError:
            await self.session.rollback()
            raise

        await self.session.commit()
        return EmailChangeAcceptedResponse(
            status="pending_confirmation",
            requested_email=new_email,
            expires_at=expires_at,
        )

    async def confirm_email_verification(self, token: str) -> EmailVerificationConfirmResponse:
        """トークンを検証してメールアドレスを確定する。
        email_change の場合はユーザーの email を更新し token_version をインクリメントする。
        """
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        result = await self.session.execute(
            select(EmailVerificationRequest).where(
                EmailVerificationRequest.token_hash == token_hash
            )
        )
        evr = result.scalar_one_or_none()

        if evr is None:
            raise KintBadRequestError(
                code="INVALID_TOKEN",
                message="トークンが無効です",
            )
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        if evr.consumed_at is not None or evr.cancelled_at is not None:
            raise KintBadRequestError(
                code="TOKEN_ALREADY_USED",
                message="このトークンはすでに使用済みです",
            )
        if evr.expires_at < now:
            raise KintBadRequestError(
                code="TOKEN_EXPIRED",
                message="トークンの有効期限が切れています",
            )

        # ユーザー取得
        user_result = await self.session.execute(select(User).where(User.id == evr.user_id))
        user = user_result.scalar_one_or_none()
        if user is None:
            raise KintBadRequestError(
                code="USER_NOT_FOUND",
                message="対象ユーザーが見つかりません",
            )

        before_email = user.email
        confirmed_email = evr.requested_email

        # トークンを消費済みに更新
        evr.consumed_at = now

        if evr.verification_type == "email_change":
            user.email = confirmed_email
            user.email_verified_at = now
            user.token_version = (user.token_version or 1) + 1

            log = UserProfileChangeLog(
                id=str(uuid.uuid4()),
                user_id=user.id,
                actor_user_id=user.id,
                actor_role=user.role,
                event_type="email_change_confirmed",
                before_email=before_email,
                after_email=confirmed_email,
                reason="メールアドレス変更確認完了",
            )
            self.session.add(log)
        elif evr.verification_type == "signup":
            user.email_verified_at = now

        await self.session.commit()
        return EmailVerificationConfirmResponse(
            verification_type=evr.verification_type,  # type: ignore[arg-type]
            email=confirmed_email,
            status="confirmed",
        )

    async def change_password(
        self,
        current_user: User,
        current_password: str,
        new_password: str,
    ) -> None:
        """パスワードを変更する。current_password 不一致は KintUnauthorizedError。
        変更成功時は token_version をインクリメントしてセッションを無効化する。
        """
        if not bcrypt.checkpw(current_password.encode(), current_user.password_hash.encode()):
            raise KintUnauthorizedError(
                code="INVALID_PASSWORD",
                message="現在のパスワードが正しくありません",
            )

        current_user.password_hash = _hash_password(new_password)
        current_user.token_version = (current_user.token_version or 1) + 1

        log = UserProfileChangeLog(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="password",
            reason="本人によるパスワード変更",
        )
        self.session.add(log)
        await self.session.commit()

    async def _cancel_pending_email_verification(
        self, user_id: str, verification_type: str
    ) -> None:
        """指定ユーザーの未消費・未キャンセルな確認リクエストをキャンセルする。"""
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        result = await self.session.execute(
            select(EmailVerificationRequest).where(
                EmailVerificationRequest.user_id == user_id,
                EmailVerificationRequest.verification_type == verification_type,
                EmailVerificationRequest.consumed_at.is_(None),
                EmailVerificationRequest.cancelled_at.is_(None),
            )
        )
        for evr in result.scalars().all():
            evr.cancelled_at = now

    async def export_users(self) -> list[UserBackupSchema]:
        """全ユーザーとそれに紐づくカード情報をエクスポート形式で取得する。"""
        result = await self.session.execute(
            select(User).options(selectinload(User.cards)).order_by(User.created_at)
        )
        users = result.scalars().all()

        backup_list = []
        for u in users:
            cards_backup = [
                CardBackupSchema(
                    card_idm=c.card_idm, name=c.name, is_active=bool(c.is_active)
                )
                for c in u.cards
            ]
            backup_list.append(
                UserBackupSchema(
                    id=u.id,
                    name=u.name,
                    full_name=u.full_name,
                    email=u.email,
                    password_hash=u.password_hash,
                    google_sub=u.google_sub,
                    role=u.role,  # type: ignore[arg-type]
                    google_calendar_id=u.google_calendar_id,
                    email_verified_at=u.email_verified_at,
                    is_active=bool(u.is_active),
                    cards=cards_backup,
                )
            )
        return backup_list

    async def import_users(self, backup_data: list[UserBackupSchema]) -> dict:
        """ユーザーとカード情報の一括復元（UPSERT）を行う。エラー時は該当ユーザーのみスキップする。"""
        imported_count = 0
        updated_count = 0
        failed_count = 0
        errors = []

        # ファイル内でのカードIDmの重複チェック用
        idm_to_user = {}
        file_duplicate_idms = set()
        for u_data in backup_data:
            for c_data in u_data.cards:
                if c_data.card_idm in idm_to_user:
                    file_duplicate_idms.add(c_data.card_idm)
                idm_to_user[c_data.card_idm] = u_data.id

        # 順次UPSERT処理
        for u_data in backup_data:
            # 各ユーザーごとにセーブポイントを作成し、エラー時はそのユーザーのみロールバックする
            async with self.session.begin_nested():
                try:
                    # 1. ファイル内重複チェックに引っかかっているか検証
                    for c_data in u_data.cards:
                        if c_data.card_idm in file_duplicate_idms:
                            raise KintConflictError(
                                code="CARD_IDM_CONFLICT",
                                message=f"カード IDm '{c_data.card_idm}' がインポートファイル内で複数定義されています",
                            )

                    # 2. 既存DBのカード重複チェック (他ユーザーが既にそのIDmを使っているか)
                    for c_data in u_data.cards:
                        stmt = select(Card).where(Card.card_idm == c_data.card_idm)
                        res = await self.session.execute(stmt)
                        existing_card = res.scalar_one_or_none()
                        if existing_card is not None and existing_card.user_id != u_data.id:
                            raise KintConflictError(
                                code="CARD_IDM_CONFLICT",
                                message=f"カード IDm '{c_data.card_idm}' はすでに別のユーザー（ID: {existing_card.user_id}）に登録されています",
                            )

                    # 3. 既存DBのメールアドレス重複チェック (他ユーザーが既にそのアドレスを使っているか)
                    stmt = select(User).where(User.email == u_data.email, User.id != u_data.id)
                    res = await self.session.execute(stmt)
                    dup_email_user = res.scalar_one_or_none()
                    if dup_email_user is not None:
                        raise KintConflictError(
                            code="EMAIL_CONFLICT",
                            message=f"メールアドレス '{u_data.email}' はすでに別のユーザー（ID: {dup_email_user.id}）に使用されています",
                        )

                    # 4. ユーザー情報のUPSERT
                    stmt = select(User).where(User.id == u_data.id).options(selectinload(User.cards))
                    res = await self.session.execute(stmt)
                    user = res.scalar_one_or_none()

                    is_new = False
                    if user is None:
                        is_new = True
                        user = User(id=u_data.id)
                        self.session.add(user)

                    user.name = u_data.name
                    user.full_name = u_data.full_name
                    user.email = u_data.email
                    user.role = u_data.role
                    user.is_active = 1 if u_data.is_active else 0
                    user.google_sub = u_data.google_sub
                    user.google_calendar_id = u_data.google_calendar_id
                    user.email_verified_at = u_data.email_verified_at
                    if u_data.password_hash:
                        user.password_hash = u_data.password_hash

                    # 5. カード同期
                    backup_idms = {c.card_idm for c in u_data.cards}

                    # インポートファイルに含まれない既存カードは物理削除
                    if not is_new:
                        for existing_card in list(user.cards):
                            if existing_card.card_idm not in backup_idms:
                                await self.session.delete(existing_card)

                    # インポートに含まれるカードをUPSERT
                    existing_cards_by_idm = (
                        {c.card_idm: c for c in user.cards} if not is_new else {}
                    )
                    for c_data in u_data.cards:
                        if c_data.card_idm in existing_cards_by_idm:
                            c_obj = existing_cards_by_idm[c_data.card_idm]
                            c_obj.name = c_data.name
                            c_obj.is_active = 1 if c_data.is_active else 0
                        else:
                            new_card = Card(
                                id=str(uuid.uuid4()),
                                user_id=user.id,
                                card_idm=c_data.card_idm,
                                name=c_data.name,
                                is_active=1 if c_data.is_active else 0,
                            )
                            self.session.add(new_card)

                    # セーブポイント内で一時的にDBへフラッシュし制約違反等を検知する
                    await self.session.flush()

                    if is_new:
                        imported_count += 1
                    else:
                        updated_count += 1

                except Exception as e:
                    # このユーザーのセーブポイントでの変更のみロールバックされる
                    failed_count += 1
                    code = getattr(e, "code", "IMPORT_ERROR")
                    message = getattr(e, "message", str(e))
                    errors.append(ImportErrorItem(id=u_data.id, code=code, message=message))

        await self.session.commit()
        return {
            "imported_count": imported_count,
            "updated_count": updated_count,
            "failed_count": failed_count,
            "errors": errors,
        }
