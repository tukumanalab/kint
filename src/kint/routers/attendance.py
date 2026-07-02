"""勤怠ルーター。GET/PATCH /api/v1/attendance および履歴取得を提供する。"""

from datetime import date

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.attendance import Attendance
from kint.models.user import User
from kint.schemas.attendance import (
    AttendanceCorrectionRequestApprove,
    AttendanceCorrectionRequestCreate,
    AttendanceCorrectionRequestListResponse,
    AttendanceCorrectionRequestReject,
    AttendanceCorrectionRequestResponse,
    AttendanceCreateRequest,
    AttendanceHistoryResponse,
    AttendanceImportResponse,
    AttendanceListResponse,
    AttendanceLockRequest,
    AttendanceLockResponse,
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
    """勤怠記録を修正する。変更履歴を同一トランザクションで保存する。管理者のみ実行可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="この操作は管理者のみ許可されています",
        )

    service = AttendanceService(session)
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


@router.post("/requests", response_model=AttendanceCorrectionRequestResponse, status_code=201)
async def create_correction_request(
    body: AttendanceCorrectionRequestCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceCorrectionRequestResponse:
    """勤怠修正申請を登録する。一般従業員は自分の記録のみ、管理者は誰の分でも申請可能。"""
    service = AttendanceService(session)
    r = await service.create_correction_request(
        author_id=current_user.id,
        creator_role=current_user.role,
        body=body,
    )
    return AttendanceCorrectionRequestResponse(
        id=r.id,
        attendance_id=r.attendance_id,
        user_id=r.user_id,
        requested_check_in=r.requested_check_in,
        requested_check_out=r.requested_check_out,
        reason=r.reason,
        status=r.status,  # type: ignore[arg-type]
        approved_by_user_id=r.approved_by_user_id,
        approval_comment=r.approval_comment,
        created_at=r.created_at,
        updated_at=r.updated_at,
        user_name=r.user.name if r.user else None,
        user_full_name=r.user.full_name if r.user else None,
        approved_by_name=r.approved_by.name if r.approved_by else None,
        work_date=r.attendance.work_date if r.attendance else None,
        original_check_in=r.attendance.check_in if r.attendance else None,
        original_check_out=r.attendance.check_out if r.attendance else None,
    )


@router.get("/requests", response_model=AttendanceCorrectionRequestListResponse)
async def list_correction_requests(
    status: str | None = Query(default=None, pattern=r"^(pending|approved|rejected)$"),
    user_id: str | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceCorrectionRequestListResponse:
    """修正申請の一覧を取得する。一般従業員は自分の申請のみ、管理者は全員分参照できる。"""
    if current_user.role == "employee":
        user_id = current_user.id

    service = AttendanceService(session)
    reqs = await service.list_correction_requests(status=status, user_id=user_id)

    items = []
    for r in reqs:
        items.append(
            AttendanceCorrectionRequestResponse(
                id=r.id,
                attendance_id=r.attendance_id,
                user_id=r.user_id,
                requested_check_in=r.requested_check_in,
                requested_check_out=r.requested_check_out,
                reason=r.reason,
                status=r.status,  # type: ignore[arg-type]
                approved_by_user_id=r.approved_by_user_id,
                approval_comment=r.approval_comment,
                created_at=r.created_at,
                updated_at=r.updated_at,
                user_name=r.user.name if r.user else None,
                user_full_name=r.user.full_name if r.user else None,
                approved_by_name=r.approved_by.name if r.approved_by else None,
                work_date=r.attendance.work_date if r.attendance else None,
                original_check_in=r.attendance.check_in if r.attendance else None,
                original_check_out=r.attendance.check_out if r.attendance else None,
            )
        )
    return AttendanceCorrectionRequestListResponse(items=items, total=len(items))


@router.post("/requests/{request_id}/approve", response_model=AttendanceCorrectionRequestResponse)
async def approve_correction_request(
    request_id: str,
    body: AttendanceCorrectionRequestApprove,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceCorrectionRequestResponse:
    """申請を承認する。管理者（admin）のみ利用可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(code="FORBIDDEN", message="この操作は管理者のみ許可されています")

    service = AttendanceService(session)
    r = await service.approve_correction_request(
        request_id=request_id,
        actor=current_user,
        comment=body.approval_comment,
    )
    return AttendanceCorrectionRequestResponse(
        id=r.id,
        attendance_id=r.attendance_id,
        user_id=r.user_id,
        requested_check_in=r.requested_check_in,
        requested_check_out=r.requested_check_out,
        reason=r.reason,
        status=r.status,  # type: ignore[arg-type]
        approved_by_user_id=r.approved_by_user_id,
        approval_comment=r.approval_comment,
        created_at=r.created_at,
        updated_at=r.updated_at,
        user_name=r.user.name if r.user else None,
        user_full_name=r.user.full_name if r.user else None,
        approved_by_name=r.approved_by.name if r.approved_by else None,
        work_date=r.attendance.work_date if r.attendance else None,
        original_check_in=r.attendance.check_in if r.attendance else None,
        original_check_out=r.attendance.check_out if r.attendance else None,
    )


@router.post("/requests/{request_id}/reject", response_model=AttendanceCorrectionRequestResponse)
async def reject_correction_request(
    request_id: str,
    body: AttendanceCorrectionRequestReject,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceCorrectionRequestResponse:
    """申請を却下する。管理者（admin）のみ利用可能。コメントは必須。"""
    if current_user.role != "admin":
        raise KintForbiddenError(code="FORBIDDEN", message="この操作は管理者のみ許可されています")

    service = AttendanceService(session)
    r = await service.reject_correction_request(
        request_id=request_id,
        actor=current_user,
        comment=body.approval_comment,
    )
    return AttendanceCorrectionRequestResponse(
        id=r.id,
        attendance_id=r.attendance_id,
        user_id=r.user_id,
        requested_check_in=r.requested_check_in,
        requested_check_out=r.requested_check_out,
        reason=r.reason,
        status=r.status,  # type: ignore[arg-type]
        approved_by_user_id=r.approved_by_user_id,
        approval_comment=r.approval_comment,
        created_at=r.created_at,
        updated_at=r.updated_at,
        user_name=r.user.name if r.user else None,
        user_full_name=r.user.full_name if r.user else None,
        approved_by_name=r.approved_by.name if r.approved_by else None,
        work_date=r.attendance.work_date if r.attendance else None,
        original_check_in=r.attendance.check_in if r.attendance else None,
        original_check_out=r.attendance.check_out if r.attendance else None,
    )


@router.delete("/requests/{request_id}", status_code=204)
async def cancel_correction_request(
    request_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    """申請をキャンセルする。一般従業員は自分の未承認の申請のみ、管理者は誰の分でもキャンセル可能。"""
    service = AttendanceService(session)
    await service.cancel_correction_request(
        request_id=request_id,
        user_id=current_user.id,
        role=current_user.role,
    )


@router.post("/locks", response_model=AttendanceLockResponse, status_code=201)
async def lock_month(
    body: AttendanceLockRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceLockResponse:
    """指定した年月を締め処理（ロック）する。管理者（admin）のみ利用可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(code="FORBIDDEN", message="この操作は管理者のみ許可されています")

    service = AttendanceService(session)
    lock = await service.lock_month(year_month=body.year_month, actor_id=current_user.id)
    return AttendanceLockResponse.model_validate(lock)


@router.delete("/locks/{year_month}", status_code=204)
async def unlock_month(
    year_month: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    """指定した年月の締め処理を解除する。管理者（admin）のみ利用可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(code="FORBIDDEN", message="この操作は管理者のみ許可されています")

    service = AttendanceService(session)
    await service.unlock_month(year_month=year_month)


@router.get("/locks", response_model=list[AttendanceLockResponse])
async def list_locks(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[AttendanceLockResponse]:
    """締め（ロック）されている年月の一覧を取得する。全員利用可能。"""
    service = AttendanceService(session)
    locks = await service.list_locks()
    return [AttendanceLockResponse.model_validate(lock) for lock in locks]


@router.post("", response_model=AttendanceRecord, status_code=201)
async def create_attendance_manually(
    body: AttendanceCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceRecord:
    """管理者が手動で従業員の勤怠記録を追加する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="この操作は管理者のみ許可されています",
        )

    service = AttendanceService(session)
    return await service.create_attendance_manually(body, current_user)


@router.delete("/{attendance_id}", status_code=204)
async def delete_attendance(
    attendance_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    """管理者が勤怠記録を削除する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="この操作は管理者のみ許可されています",
        )

    service = AttendanceService(session)
    await service.delete_attendance(attendance_id, current_user)


@router.post("/import-csv", response_model=AttendanceImportResponse)
async def import_attendance_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AttendanceImportResponse:
    """勤務時間報告書 CSV をアップロードして一括インポートする。管理者（admin）のみ利用可能。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="この操作は管理者のみ許可されています",
        )

    file_bytes = await file.read()
    service = AttendanceService(session)
    return await service.import_csv_report(file_bytes, current_user)
