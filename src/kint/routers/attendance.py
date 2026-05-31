"""勤怠ルーター。GET/PATCH /api/v1/attendance および履歴取得を提供する。"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.attendance import Attendance
from kint.models.user import User
from kint.schemas.attendance import (
    AttendanceHistoryResponse,
    AttendanceListResponse,
    AttendanceMonthlyDetailResponse,
    AttendanceMonthlySummary,
    AttendancePatchRequest,
    AttendanceRecord,
)
from kint.services.attendance import AttendanceService

router = APIRouter(prefix="/attendance", tags=["Attendance"])


@router.get("", response_model=AttendanceListResponse)
async def list_attendances(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    user_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceListResponse:
    """勤怠一覧を取得する。管理者は全員分、従業員は自分のみ参照できる。"""
    if current_user.role == "employee":
        user_id = current_user.id

    service = AttendanceService(session)
    return await service.list_attendances(
        from_date=from_,
        to_date=to,
        user_id=user_id,
        page=page,
        page_size=page_size,
    )


@router.patch("/{attendance_id}", response_model=AttendanceRecord)
async def patch_attendance(
    attendance_id: str,
    body: AttendancePatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceRecord:
    """勤怠記録を修正する。変更履歴を同一トランザクションで保存する。"""
    service = AttendanceService(session)

    # 従業員は自分の勤怠のみ修正可能か事前確認（サービス層呼び出し前に権限チェック）
    if current_user.role == "employee":
        result = await session.execute(
            select(Attendance.user_id).where(Attendance.id == attendance_id)
        )
        owner_id = result.scalar_one_or_none()
        if owner_id is None or owner_id != current_user.id:
            raise KintForbiddenError(
                code="FORBIDDEN",
                message="この勤怠記録を修正する権限がありません",
            )

    return await service.patch_attendance(attendance_id, body, current_user)


@router.get("/{attendance_id}/history", response_model=AttendanceHistoryResponse)
async def get_attendance_history(
    attendance_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceHistoryResponse:
    """勤怠変更履歴を取得する。管理者は全員分、従業員は自分のみ参照できる。"""
    if current_user.role == "employee":
        result = await session.execute(
            select(Attendance.user_id).where(Attendance.id == attendance_id)
        )
        owner_id = result.scalar_one_or_none()
        if owner_id is None or owner_id != current_user.id:
            raise KintForbiddenError(
                code="FORBIDDEN",
                message="この勤怠記録の履歴を参照する権限がありません",
            )

    service = AttendanceService(session)
    return await service.get_history(attendance_id)


@router.get("/summary", response_model=list[AttendanceMonthlySummary])
async def get_monthly_summaries(
    year_month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    user_id: str | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[AttendanceMonthlySummary]:
    """月次勤怠サマリーを取得する。一般従業員は自分のデータのみ、管理者は全員分参照できる。"""
    if current_user.role == "employee":
        user_id = current_user.id
    service = AttendanceService(session)
    return await service.get_monthly_summaries(year_month, user_id=user_id)


@router.get("/monthly", response_model=AttendanceMonthlyDetailResponse)
async def get_monthly_detail(
    year_month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    user_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceMonthlyDetailResponse:
    """月間日別勤怠詳細を取得する。一般従業員は自分のデータのみ、管理者は全員分参照できる。"""
    if current_user.role == "employee" and user_id != current_user.id:
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="他のユーザーの勤怠詳細情報を参照する権限がありません",
        )
    service = AttendanceService(session)
    return await service.get_monthly_detail(year_month, user_id=user_id)


@router.get("/export")
async def export_attendance_csv(
    year_month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    scope: str = Query(default="detailed", pattern=r"^(detailed|summary)$"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """勤怠データをCSVでエクスポートする。管理者（admin）のみ利用可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="この操作は管理者のみ許可されています",
        )
    service = AttendanceService(session)
    csv_bytes = await service.export_csv(year_month, scope)

    filename = f"kint_attendance_{scope}_{year_month}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

