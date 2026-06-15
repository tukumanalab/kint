import { useCallback, useEffect, useState } from 'react';
import {
  getAttendanceSummary,
  getMonthlyAttendanceDetail,
  downloadAttendanceCsv,
  lockMonth,
  unlockMonth,
  createCorrectionRequest,
  listCorrectionRequests,
  approveCorrectionRequest,
  rejectCorrectionRequest,
  cancelCorrectionRequest,
  getAttendanceHistory,
  createAttendance,
  deleteAttendance,
} from '../../api/attendance';
import type { UseAuth } from '../../hooks/useAuth';
import type {
  AttendanceMonthlySummary,
  AttendanceMonthlyDetailResponse,
  DailyAttendanceDetail,
  AttendanceCorrectionRequest,
  AttendanceHistoryEntry,
} from '../../types/attendance';
import './AttendancePage.css';

interface Props {
  auth: UseAuth;
}

export function AttendancePage({ auth }: Props) {
  const [yearMonth, setYearMonth] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  const [summaries, setSummaries] = useState<AttendanceMonthlySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 詳細表示関連
  const [selectedUser, setSelectedUser] = useState<AttendanceMonthlySummary | null>(null);
  const [detailData, setDetailData] = useState<AttendanceMonthlyDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState(false);

  // 修正申請関連
  const [correctionRequests, setCorrectionRequests] = useState<AttendanceCorrectionRequest[]>([]);
  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [requestFormData, setRequestFormData] = useState({
    attendanceId: '',
    workDate: '',
    requestedCheckIn: '',
    requestedCheckOut: '',
    originalCheckIn: '',
    originalCheckOut: '',
    requestedCheckInDate: '',
    requestedCheckInTime: '',
    requestedCheckOutDate: '',
    requestedCheckOutTime: '',
    reason: '',
  });
  const [approvalFormData, setApprovalFormData] = useState({
    requestId: '',
    action: '' as 'approve' | 'reject',
    comment: '',
  });
  const [selectedRequestForApproval, setSelectedRequestForApproval] = useState<AttendanceCorrectionRequest | null>(null);

  // 変更履歴関連
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState<AttendanceHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyWorkDate, setHistoryWorkDate] = useState('');

  // 手動勤怠追加関連 (管理者用)
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormData, setAddFormData] = useState({
    workDate: '',
    checkInDate: '',
    checkInTime: '',
    checkOutDate: '',
    checkOutTime: '',
    reason: '',
  });

  const isAdmin = auth.user?.role === 'admin';

  const handleViewHistory = async (attendanceId: string, workDate: string) => {
    if (!auth.token) return;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryWorkDate(workDate);
    setShowHistoryModal(true);
    try {
      const res = await getAttendanceHistory(auth.token, attendanceId);
      setHistoryData(res.items);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : '変更履歴の取得に失敗しました');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenAddModal = (workDate: string) => {
    setAddFormData({
      workDate,
      checkInDate: workDate,
      checkInTime: '',
      checkOutDate: workDate,
      checkOutTime: '',
      reason: '',
    });
    setShowAddModal(true);
  };

  const handleSubmitAdd = async () => {
    if (!auth.token) return;
    const targetUserId = selectedUser?.user_id || auth.user?.id;
    if (!targetUserId) return;

    if (!addFormData.reason.trim()) {
      alert('理由を入力してください。');
      return;
    }

    let checkInStr: string | null = null;
    if (addFormData.checkInDate && addFormData.checkInTime) {
      checkInStr = new Date(`${addFormData.checkInDate}T${addFormData.checkInTime}:00`).toISOString();
    }

    let checkOutStr: string | null = null;
    if (addFormData.checkOutDate && addFormData.checkOutTime) {
      checkOutStr = new Date(`${addFormData.checkOutDate}T${addFormData.checkOutTime}:00`).toISOString();
    }

    try {
      await createAttendance(auth.token, {
        user_id: targetUserId,
        work_date: addFormData.workDate,
        check_in: checkInStr,
        check_out: checkOutStr,
        reason: addFormData.reason,
      });
      setShowAddModal(false);
      // 再読み込み
      await fetchSummary();
      if (selectedUser) {
        const updatedDetail = await getMonthlyAttendanceDetail(auth.token, yearMonth, selectedUser.user_id);
        setDetailData(updatedDetail);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '勤怠記録の追加に失敗しました');
    }
  };

  const handleDeleteAttendance = async (attendanceId: string) => {
    if (!auth.token) return;
    if (!window.confirm('この勤怠記録を削除してもよろしいですか？\n削除すると、この記録に関連する変更履歴や申請情報も削除されます。')) {
      return;
    }

    try {
      await deleteAttendance(auth.token, attendanceId);
      // 再読み込み
      await fetchSummary();
      if (selectedUser) {
        const updatedDetail = await getMonthlyAttendanceDetail(auth.token, yearMonth, selectedUser.user_id);
        setDetailData(updatedDetail);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '勤怠記録の削除に失敗しました');
    }
  };

  // サマリー (管理者：全員、一般：自分のみ) の取得
  const fetchSummary = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true);
    setError(null);
    try {
      // getAttendanceSummary は、バックエンド側で一般従業員の場合 user_id を自動で自分自身に制限
      const data = await getAttendanceSummary(auth.token, yearMonth);
      setSummaries(data);

      // 一般従業員の場合は、自動的に詳細もロードしてあげる
      if (!isAdmin && data.length > 0) {
        handleViewDetail(data[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '勤怠データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, yearMonth, isAdmin]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // 修正申請一覧の取得
  const fetchCorrectionRequests = useCallback(async () => {
    if (!auth.token) return;
    try {
      const data = await listCorrectionRequests(auth.token);
      setCorrectionRequests(data.items);
    } catch (err) {
      console.error('修正申請の取得に失敗しました:', err);
    }
  }, [auth.token]);

  useEffect(() => {
    fetchCorrectionRequests();
  }, [fetchCorrectionRequests]);

  // 詳細データの取得
  const handleViewDetail = async (summary: AttendanceMonthlySummary) => {
    if (!auth.token) return;
    setSelectedUser(summary);
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);
    try {
      const data = await getMonthlyAttendanceDetail(auth.token, yearMonth, summary.user_id);
      setDetailData(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '詳細データの取得に失敗しました');
    } finally {
      setDetailLoading(false);
    }
  };

  // CSVダウンロード
  const handleDownloadCsv = async (scope: 'summary' | 'detailed') => {
    if (!auth.token) return;
    try {
      const blob = await downloadAttendanceCsv(auth.token, yearMonth, scope);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kint_attendance_${scope}_${yearMonth}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'CSVのダウンロードに失敗しました');
    }
  };

  // ロック/アンロック操作
  const handleLockToggle = async () => {
    if (!auth.token || !isAdmin) return;
    
    const isCurrentlyLocked = detailData?.is_locked ?? false;
    const confirmMsg = isCurrentlyLocked
      ? `${yearMonth} の締めを解除しますか？解除すると打刻や修正が再び可能になります。`
      : `${yearMonth} を締めますか？締めると該当月の打刻・修正ができなくなります。`;
    
    if (!window.confirm(confirmMsg)) return;

    setLockLoading(true);
    try {
      if (isCurrentlyLocked) {
        await unlockMonth(auth.token, yearMonth);
      } else {
        await lockMonth(auth.token, yearMonth);
      }
      // 詳細データを再取得して最新のロック状態を反映
      if (selectedUser) {
        await handleViewDetail(selectedUser);
      } else if (!isAdmin && summaries.length > 0) {
        await handleViewDetail(summaries[0]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ロック操作に失敗しました');
    } finally {
      setLockLoading(false);
    }
  };

  const toLocalValues = (isoStr: string | null, fallbackDate: string) => {
    if (!isoStr) return { date: fallbackDate, time: '' };
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return { date: fallbackDate, time: '' };

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
  };

  const toUTCISOString = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return null;
    const dateParts = dateStr.split('-');
    const timeParts = timeStr.split(':');
    if (dateParts.length !== 3 || timeParts.length < 2) return null;
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const d = new Date(year, month, day, hours, minutes);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  // 修正申請の作成
  const handleOpenRequestModal = (attendanceId: string, workDate: string, checkIn: string | null, checkOut: string | null) => {
    const localIn = toLocalValues(checkIn, workDate);
    const localOut = toLocalValues(checkOut, workDate);

    setRequestFormData({
      attendanceId,
      workDate,
      requestedCheckIn: checkIn || '',
      requestedCheckOut: checkOut || '',
      originalCheckIn: checkIn || '',
      originalCheckOut: checkOut || '',
      requestedCheckInDate: localIn.date,
      requestedCheckInTime: localIn.time,
      requestedCheckOutDate: localOut.date,
      requestedCheckOutTime: localOut.time,
      reason: '',
    });
    setShowRequestModal(true);
  };

  const handleSubmitRequest = async () => {
    if (!auth.token || !requestFormData.reason.trim()) {
      alert('理由を入力してください');
      return;
    }

    const isoIn = toUTCISOString(requestFormData.requestedCheckInDate, requestFormData.requestedCheckInTime);
    const isoOut = toUTCISOString(requestFormData.requestedCheckOutDate, requestFormData.requestedCheckOutTime);

    if (isoIn && isoOut) {
      const inTime = new Date(isoIn).getTime();
      const outTime = new Date(isoOut).getTime();
      if (inTime >= outTime) {
        alert('退勤時刻は出勤時刻より後の日時を指定してください');
        return;
      }
      if (outTime - inTime <= 5 * 60 * 1000) {
        alert('出勤時刻から5分以内の退勤時刻への修正申請は受け付けられません。');
        return;
      }
    }

    try {
      await createCorrectionRequest(auth.token, {
        attendance_id: requestFormData.attendanceId,
        requested_check_in: isoIn,
        requested_check_out: isoOut,
        reason: requestFormData.reason,
      });
      alert('修正申請を提出しました');
      setShowRequestModal(false);
      await fetchCorrectionRequests();
      if (selectedUser) {
        await handleViewDetail(selectedUser);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '修正申請の提出に失敗しました');
    }
  };

  // 修正申請の承認/却下（管理者のみ）
  const handleOpenApprovalModal = (request: AttendanceCorrectionRequest, action: 'approve' | 'reject') => {
    setApprovalFormData({
      requestId: request.id,
      action,
      comment: '',
    });
    setSelectedRequestForApproval(request);
    setShowApprovalModal(true);
  };

  const handleSubmitApproval = async () => {
    if (!auth.token) return;
    
    if (approvalFormData.action === 'reject' && !approvalFormData.comment.trim()) {
      alert('却下する場合はコメントが必須です');
      return;
    }

    try {
      if (approvalFormData.action === 'approve') {
        await approveCorrectionRequest(auth.token, approvalFormData.requestId, approvalFormData.comment || undefined);
        alert('申請を承認しました');
      } else {
        await rejectCorrectionRequest(auth.token, approvalFormData.requestId, approvalFormData.comment);
        alert('申請を却下しました');
      }
      setShowApprovalModal(false);
      setSelectedRequestForApproval(null);
      await fetchCorrectionRequests();
      // 詳細データも再取得（勤怠レコードが更新されている可能性があるため）
      if (selectedUser) {
        await handleViewDetail(selectedUser);
      } else if (!isAdmin && summaries.length > 0) {
        await handleViewDetail(summaries[0]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '処理に失敗しました');
    }
  };

  // 修正申請のキャンセル
  const handleCancelRequest = async (requestId: string) => {
    if (!auth.token) return;
    if (!window.confirm('この申請をキャンセルしますか？')) return;

    try {
      await cancelCorrectionRequest(auth.token, requestId);
      alert('申請をキャンセルしました');
      await fetchCorrectionRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'キャンセルに失敗しました');
    }
  };

  const getStatusBadge = (status: DailyAttendanceDetail['status']) => {
    switch (status) {
      case 'normal':
        return <span className="att-badge att-badge--normal">正常</span>;
      case 'late':
        return <span className="att-badge att-badge--late">遅刻</span>;
      case 'early_leave':
        return <span className="att-badge att-badge--early">早退</span>;
      case 'late_and_early':
        return <span className="att-badge att-badge--late-early">遅刻 & 早退</span>;
      case 'absence':
        return <span className="att-badge att-badge--absence">欠勤</span>;
      case 'scheduled':
        return <span className="att-badge att-badge--scheduled">出勤予定</span>;
      case 'incomplete':
        return <span className="att-badge att-badge--incomplete">打刻不整合</span>;
      case 'off_duty':
        return <span className="att-badge att-badge--off-duty">休日等</span>;
      default:
        return <span className="att-badge">{status}</span>;
    }
  };

  const getSourceLabel = (source: string | null) => {
    if (!source) return '-';
    switch (source) {
      case 'webusb_nfc':
        return 'NFC (PaSoRi)';
      case 'web_user_id':
        return 'Web打刻 (ID入力)';
      case 'admin_manual':
        return '管理者修正';
      case 'self_service':
        return '自己申告';
      default:
        return source;
    }
  };

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '-';
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '-';
    }
  };

  const formatPunchTime = (calcTime: string | null | undefined, rawTime: string | null | undefined) => {
    if (!calcTime && !rawTime) return '-';
    const calcStr = calcTime ? formatTime(calcTime) : '-';
    const rawStr = rawTime ? formatTime(rawTime) : '-';
    return (
      <span className="att-punch-time-combined">
        <span className="att-punch-time-calc">{calcStr}</span>
        <span className="att-punch-time-raw">({rawStr})</span>
      </span>
    );
  };

  const formatHours = (hours: number | null) => {
    if (hours === null || hours === undefined) return '-';
    return `${hours.toFixed(2)}h`;
  };

  const getDayOfWeek = (dateStr: string) => {
    const weekday = ['日', '月', '火', '水', '木', '金', '土'];
    const d = new Date(dateStr);
    const day = d.getDay();
    let className = 'att-day-normal';
    if (day === 0) className = 'att-day-sunday';
    if (day === 6) className = 'att-day-saturday';
    return <span className={className}>({weekday[day]})</span>;
  };

  const getRequestDiff = () => {
    const origIn = requestFormData.originalCheckIn ? new Date(requestFormData.originalCheckIn) : null;
    const origOut = requestFormData.originalCheckOut ? new Date(requestFormData.originalCheckOut) : null;

    const isoIn = toUTCISOString(requestFormData.requestedCheckInDate, requestFormData.requestedCheckInTime);
    const isoOut = toUTCISOString(requestFormData.requestedCheckOutDate, requestFormData.requestedCheckOutTime);
    const reqIn = isoIn ? new Date(isoIn) : null;
    const reqOut = isoOut ? new Date(isoOut) : null;

    const formatLocalDateAndTime = (d: Date | null) => {
      if (!d) return '未打刻';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hh}:${min}`;
    };

    const calcHours = (start: Date | null, end: Date | null) => {
      if (!start || !end) return 0;
      const ms = end.getTime() - start.getTime();
      return ms > 0 ? ms / (1000 * 60 * 60) : 0;
    };

    const origHours = calcHours(origIn, origOut);
    const reqHours = calcHours(reqIn, reqOut);
    const hoursDiff = reqHours - origHours;

    return {
      origInStr: formatLocalDateAndTime(origIn),
      origOutStr: formatLocalDateAndTime(origOut),
      reqInStr: formatLocalDateAndTime(reqIn),
      reqOutStr: formatLocalDateAndTime(reqOut),
      origHours,
      reqHours,
      hoursDiff,
      isIncomplete: !reqIn || !reqOut,
    };
  };

  const getApprovalDiff = (request: AttendanceCorrectionRequest | null) => {
    if (!request) {
      return {
        origInStr: '未打刻',
        origOutStr: '未打刻',
        reqInStr: '未打刻',
        reqOutStr: '未打刻',
        origHours: 0,
        reqHours: 0,
        hoursDiff: 0,
      };
    }

    const origIn = request.original_check_in ? new Date(request.original_check_in) : null;
    const origOut = request.original_check_out ? new Date(request.original_check_out) : null;
    const reqIn = request.requested_check_in ? new Date(request.requested_check_in) : null;
    const reqOut = request.requested_check_out ? new Date(request.requested_check_out) : null;

    const formatLocalDateAndTime = (d: Date | null) => {
      if (!d) return '未打刻';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hh}:${min}`;
    };

    const calcHours = (start: Date | null, end: Date | null) => {
      if (!start || !end) return 0;
      const ms = end.getTime() - start.getTime();
      return ms > 0 ? ms / (1000 * 60 * 60) : 0;
    };

    const origHours = calcHours(origIn, origOut);
    const reqHours = calcHours(reqIn, reqOut);
    const hoursDiff = reqHours - origHours;

    return {
      origInStr: formatLocalDateAndTime(origIn),
      origOutStr: formatLocalDateAndTime(origOut),
      reqInStr: formatLocalDateAndTime(reqIn),
      reqOutStr: formatLocalDateAndTime(reqOut),
      origHours,
      reqHours,
      hoursDiff,
    };
  };

  const renderDetailDays = (days: DailyAttendanceDetail[]) => {
    let weeklyWorkingDays = 0;
    let weeklyWorkingHours = 0;
    const rows: React.ReactNode[] = [];

    days.forEach((day, index) => {
      const hasPunch = (day.punches && day.punches.length > 0) || day.check_in !== null;
      if (hasPunch) {
        weeklyWorkingDays += 1;
      }
      if (day.working_hours) {
        weeklyWorkingHours += day.working_hours;
      }

      const isAbsence = day.status === 'absence';
      const isHighlight = day.is_holiday || !day.has_shift;

      rows.push(
        <tr
          key={day.work_date}
          className={`${isAbsence ? 'tr--absence' : ''} ${isHighlight ? 'tr--holiday' : ''}`}
        >
          <td>
            {day.work_date} {getDayOfWeek(day.work_date)}
          </td>
          <td>
            {day.shifts && day.shifts.length > 0 ? (
              <div className="att-multiple-shifts">
                {day.shifts.map((s, idx) => (
                  <div key={idx} className="att-shift-item">
                    {formatTime(s.start_time)} 〜 {formatTime(s.end_time)}
                  </div>
                ))}
              </div>
            ) : day.has_shift && day.shift_start && day.shift_end ? (
              <span>
                {formatTime(day.shift_start)} 〜 {formatTime(day.shift_end)}
              </span>
            ) : (
              <span className="att-text--muted">公休</span>
            )}
          </td>
          <td>
            {day.punches && day.punches.length > 0 ? (
              <div className="att-multiple-punches">
                {day.punches.map((p, idx) => (
                  <div key={idx} className="att-punch-item">
                    {formatPunchTime(p.calculated_check_in, p.check_in)}
                  </div>
                ))}
              </div>
            ) : (
              formatPunchTime(day.calculated_check_in, day.check_in)
            )}
          </td>
          <td>
            {day.punches && day.punches.length > 0 ? (
              <div className="att-multiple-punches">
                {day.punches.map((p, idx) => (
                  <div key={idx} className="att-punch-item">
                    {formatPunchTime(p.calculated_check_out, p.check_out)}
                  </div>
                ))}
              </div>
            ) : (
              formatPunchTime(day.calculated_check_out, day.check_out)
            )}
          </td>
          <td>{formatHours(day.working_hours)}</td>
          <td>{formatHours(day.overtime_hours)}</td>
          <td>{getStatusBadge(day.status)}</td>
          <td>
            {day.punches && day.punches.length > 0 ? (
              <div className="att-multiple-punches">
                {day.punches.map((p, idx) => (
                  <div key={idx} className="att-punch-item">
                    {getSourceLabel(p.source ?? null)}
                  </div>
                ))}
              </div>
            ) : (
              <>
                {getSourceLabel(day.source)}
                {day.is_auto_completed && (
                  <span className="att-badge att-badge--auto-completed" style={{ marginLeft: '6px' }}>
                    自動補完
                  </span>
                )}
              </>
            )}
          </td>
          <td>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {day.punches && day.punches.length > 0 ? (
                <div className="att-multiple-punches" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {day.punches.map((p, idx) => (
                    <div key={idx} className="att-punch-item" style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      {detailData && !detailData.is_locked && p.attendance_id && (
                        <>
                          <button
                            type="button"
                            className="att-btn att-btn--small"
                            onClick={() =>
                              handleOpenRequestModal(
                                p.attendance_id!,
                                day.work_date,
                                p.check_in,
                                p.check_out
                              )
                            }
                          >
                            {isAdmin ? '修正' : '修正申請'}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="att-btn att-btn--small"
                              style={{ background: '#d73a49', color: '#fff' }}
                              onClick={() => handleDeleteAttendance(p.attendance_id!)}
                            >
                              削除
                            </button>
                          )}
                        </>
                      )}
                      {p.attendance_id && (
                        <button
                          type="button"
                          className="att-btn att-btn--small att-btn--secondary"
                          onClick={() => handleViewHistory(p.attendance_id!, day.work_date)}
                        >
                          履歴
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                day.attendance_id && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                    {detailData && !detailData.is_locked && (
                      <>
                        <button
                          type="button"
                          className="att-btn att-btn--small"
                          onClick={() =>
                            handleOpenRequestModal(
                              day.attendance_id!,
                              day.work_date,
                              day.check_in,
                              day.check_out
                            )
                          }
                        >
                          {isAdmin ? '修正' : '修正申請'}
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="att-btn att-btn--small"
                            style={{ background: '#d73a49', color: '#fff' }}
                            onClick={() => handleDeleteAttendance(day.attendance_id!)}
                          >
                            削除
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="att-btn att-btn--small att-btn--secondary"
                      onClick={() => handleViewHistory(day.attendance_id!, day.work_date)}
                    >
                      履歴
                    </button>
                  </div>
                )
              )}

              {/* 管理者用：勤怠追加ボタンを常に表示 */}
              {detailData && !detailData.is_locked && isAdmin && (
                <div style={{ display: 'flex', marginTop: '2px' }}>
                  <button
                    type="button"
                    className="att-btn att-btn--small"
                    style={{ background: '#2ea44f', color: '#fff' }}
                    onClick={() => handleOpenAddModal(day.work_date)}
                  >
                    追加
                  </button>
                </div>
              )}

              {/* 一般ユーザーでレコードがない場合 */}
              {!day.attendance_id && (!day.punches || day.punches.length === 0) && !isAdmin && (
                <span className="att-text--muted">-</span>
              )}
            </div>
          </td>
        </tr>
      );

      // 週次集計の挿入判定 (日曜日、または月の最終日)
      const d = new Date(day.work_date);
      const isSunday = d.getDay() === 0;
      const isLastDay = index === days.length - 1;

      if (isSunday || isLastDay) {
        rows.push(
          <tr key={`weekly-${day.work_date}`} className="att-table__weekly-summary">
            <td colSpan={4} style={{ textAlign: 'right' }}>週次集計:</td>
            <td>{weeklyWorkingHours > 0 ? `${weeklyWorkingHours.toFixed(2)}h` : '-'}</td>
            <td>-</td>
            <td>
              <span className="att-badge att-badge--weekly">
                勤務: {weeklyWorkingDays}日
              </span>
            </td>
            <td colSpan={2}>-</td>
          </tr>
        );
        weeklyWorkingDays = 0;
        weeklyWorkingHours = 0;
      }
    });

    return rows;
  };

  return (
    <div className="attendance-page">
      <div className="attendance-page__header">
        <h1 className="attendance-page__title">勤怠管理</h1>
        <div className="attendance-page__controls">
          <div className="attendance-page__month-selector">
            <label htmlFor="yearMonth" className="attendance-page__label">
              対象年月:
            </label>
            <input
              id="yearMonth"
              type="month"
              value={yearMonth}
              onChange={(e) => {
                setYearMonth(e.target.value);
                setSelectedUser(null);
                setDetailData(null);
              }}
              className="attendance-page__input"
            />
          </div>

          {isAdmin && (
            <div className="attendance-page__csv-buttons">
              <button
                type="button"
                className="att-btn att-btn--secondary"
                onClick={() => handleDownloadCsv('summary')}
              >
                サマリー出力 (CSV)
              </button>
              <button
                type="button"
                className="att-btn att-btn--primary"
                onClick={() => handleDownloadCsv('detailed')}
              >
                全日次詳細出力 (CSV)
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="att-alert att-alert--danger">{error}</div>}

      {/* 修正申請・承認履歴管理セクション */}
      <div className="attendance-section att-requests-section">
        <div className="att-requests-header">
          <h2 className="att-requests-section-title">
            {isAdmin ? '📋 修正申請の承認・履歴' : '📋 自分の修正申請・履歴'}
          </h2>
          <div className="att-filter-tabs">
            <button
              type="button"
              className={`att-filter-tab ${requestFilter === 'pending' ? 'att-filter-tab--active' : ''}`}
              onClick={() => setRequestFilter('pending')}
            >
              承認待ち ({correctionRequests.filter((r) => r.status === 'pending').length})
            </button>
            <button
              type="button"
              className={`att-filter-tab ${requestFilter === 'approved' ? 'att-filter-tab--active' : ''}`}
              onClick={() => setRequestFilter('approved')}
            >
              承認済み ({correctionRequests.filter((r) => r.status === 'approved').length})
            </button>
            <button
              type="button"
              className={`att-filter-tab ${requestFilter === 'rejected' ? 'att-filter-tab--active' : ''}`}
              onClick={() => setRequestFilter('rejected')}
            >
              却下済み ({correctionRequests.filter((r) => r.status === 'rejected').length})
            </button>
            <button
              type="button"
              className={`att-filter-tab ${requestFilter === 'all' ? 'att-filter-tab--active' : ''}`}
              onClick={() => setRequestFilter('all')}
            >
              すべて ({correctionRequests.length})
            </button>
          </div>
        </div>

        {correctionRequests.filter((r) => requestFilter === 'all' || r.status === requestFilter).length === 0 ? (
          <div className="att-empty" style={{ padding: '24px', background: '#f6f8fa', border: '1px solid #eaecef', borderRadius: '6px', textAlign: 'center', color: '#586069' }}>
            対象の修正申請はありません。
          </div>
        ) : (
          <div className="att-table-container">
            <table className="att-table">
              <thead>
                <tr>
                  <th>申請日</th>
                  <th>対象日</th>
                  {isAdmin && <th>申請者</th>}
                  <th>修正希望内容</th>
                  <th>申請理由</th>
                  <th>状態</th>
                  <th>承認/却下者・コメント</th>
                  <th style={{ minWidth: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {correctionRequests
                  .filter((r) => requestFilter === 'all' || r.status === requestFilter)
                  .map((req) => (
                    <tr key={req.id}>
                      <td style={{ fontSize: '12px', color: '#586069' }}>
                        {req.created_at ? new Date(req.created_at).toLocaleDateString('ja-JP') : '-'}
                      </td>
                      <td style={{ fontWeight: '500' }}>{req.work_date || '-'}</td>
                      {isAdmin && (
                        <td>
                          <strong>{req.user_name}</strong>
                          {req.user_full_name && <span className="att-fullname"> ({req.user_full_name})</span>}
                        </td>
                      )}
                      <td>
                        <div style={{ fontSize: '12px' }}>
                          <span className="att-meta-label">出勤: </span>
                          {req.requested_check_in ? formatTime(req.requested_check_in) : '未打刻 (クリア)'}
                          <br />
                          <span className="att-meta-label">退勤: </span>
                          {req.requested_check_out ? formatTime(req.requested_check_out) : '未打刻 (クリア)'}
                        </div>
                      </td>
                      <td>
                        <div className="att-comment-text" style={{ maxWidth: '300px' }}>{req.reason}</div>
                      </td>
                      <td>
                        {req.status === 'pending' && <span className="att-corr-badge att-corr-badge--pending">承認待ち</span>}
                        {req.status === 'approved' && <span className="att-corr-badge att-corr-badge--approved">承認済み</span>}
                        {req.status === 'rejected' && <span className="att-corr-badge att-corr-badge--rejected">却下済み</span>}
                      </td>
                      <td>
                        {req.status !== 'pending' && (
                          <div style={{ fontSize: '12px' }}>
                            {req.approved_by_name && (
                              <div>
                                <span className="att-meta-label" style={{ fontWeight: '500' }}>対応者:</span> {req.approved_by_name}
                              </div>
                            )}
                            {req.approval_comment && (
                              <div className="att-comment-text" style={{ background: '#f1f8ff', color: '#0366d6', maxWidth: '300px', borderLeft: '3px solid #0366d6' }}>
                                {req.approval_comment}
                              </div>
                            )}
                          </div>
                        )}
                        {req.status === 'pending' && <span className="att-text--muted">-</span>}
                      </td>
                      <td>
                        {req.status === 'pending' ? (
                          isAdmin ? (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                type="button"
                                className="att-btn att-btn--small"
                                style={{ background: '#2ea44f' }}
                                onClick={() => handleOpenApprovalModal(req, 'approve')}
                              >
                                承認
                              </button>
                              <button
                                type="button"
                                className="att-btn att-btn--small"
                                style={{ background: '#d73a49' }}
                                onClick={() => handleOpenApprovalModal(req, 'reject')}
                              >
                                却下
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="att-btn att-btn--small"
                              style={{ background: '#959da5' }}
                              onClick={() => handleCancelRequest(req.id)}
                            >
                              取消
                            </button>
                          )
                        ) : (
                          <span className="att-text--muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 管理者向け：全員のサマリー一覧 */}
      {isAdmin && (
        <div className="attendance-section">
          <h2>月次勤務サマリー</h2>
          {loading ? (
            <div className="att-loading">読み込み中...</div>
          ) : summaries.length === 0 ? (
            <div className="att-empty">データが登録されていません。</div>
          ) : (
            <div className="att-table-container">
              <table className="att-table">
                <thead>
                  <tr>
                    <th>従業員名 (氏名)</th>
                    <th>所定</th>
                    <th>出勤</th>
                    <th>欠勤</th>
                    <th>遅刻</th>
                    <th>早退</th>
                    <th>不整合</th>
                    <th>総労働時間</th>
                    <th>時間外時間</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((summary) => (
                    <tr
                      key={summary.user_id}
                      className={selectedUser?.user_id === summary.user_id ? 'tr--selected' : ''}
                    >
                      <td>
                        <strong>{summary.user_name}</strong>
                        {summary.full_name && (
                          <span className="att-fullname"> ({summary.full_name})</span>
                        )}
                      </td>
                      <td>{summary.prescribed_days}日</td>
                      <td>{summary.working_days}日</td>
                      <td>
                        <span className={summary.absence_days > 0 ? 'att-text--danger' : ''}>
                          {summary.absence_days}日
                        </span>
                      </td>
                      <td>{summary.late_count}回</td>
                      <td>{summary.early_leave_count}回</td>
                      <td>
                        <span className={summary.incomplete_days > 0 ? 'att-text--warning' : ''}>
                          {summary.incomplete_days}件
                        </span>
                      </td>
                      <td>{formatHours(summary.total_working_hours)}</td>
                      <td>
                        <span className={summary.total_overtime_hours > 0 ? 'att-text--info' : ''}>
                          {formatHours(summary.total_overtime_hours)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="att-btn att-btn--small"
                          onClick={() => handleViewDetail(summary)}
                        >
                          詳細カレンダー
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 詳細カレンダー表示（管理者：選択したユーザー / 一般：ログインしている自分） */}
      {(selectedUser || !isAdmin) && (
        <div className="attendance-section">
          <h2>
            {isAdmin
              ? `【${selectedUser?.user_name}】`
              : `【${auth.user?.name}】`}
            日別勤怠詳細 ({yearMonth})
          </h2>

          {/* ロック状態表示とコントロール（管理者のみ） */}
          {!detailLoading && detailData && isAdmin && (
            <div className="att-lock-control-container">
              <div className={`att-lock-badge ${detailData.is_locked ? 'att-lock-badge--locked' : ''}`}>
                {detailData.is_locked ? '🔒 締め済み（ロック中）' : '🔓 未締め（編集可能）'}
              </div>
              <button
                type="button"
                className={`att-lock-btn ${detailData.is_locked ? 'att-lock-btn--unlock' : 'att-lock-btn--lock'}`}
                onClick={handleLockToggle}
                disabled={lockLoading}
              >
                {lockLoading
                  ? '処理中...'
                  : detailData.is_locked
                    ? '締めを解除'
                    : '月を締める'}
              </button>
            </div>
          )}

          {detailLoading && <div className="att-loading">詳細の読み込み中...</div>}
          {detailError && <div className="att-alert att-alert--danger">{detailError}</div>}

          {!detailLoading && detailData && (
            <div>
              {/* 一般ユーザー用のインジケーター（簡易サマリー表示） */}
              {!isAdmin && detailData.summary && (
                <div className="att-user-summary-card">
                  <div className="att-user-summary-card__item">
                    <span className="label">所定日数</span>
                    <span className="value">{detailData.summary.prescribed_days}日</span>
                  </div>
                  <div className="att-user-summary-card__item">
                    <span className="label">出勤日数</span>
                    <span className="value">{detailData.summary.working_days}日</span>
                  </div>
                  <div className="att-user-summary-card__item">
                    <span className="label">総労働時間</span>
                    <span className="value">{formatHours(detailData.summary.total_working_hours)}</span>
                  </div>
                  <div className="att-user-summary-card__item">
                    <span className="label">時間外労働</span>
                    <span className="value">{formatHours(detailData.summary.total_overtime_hours)}</span>
                  </div>
                  <div className="att-user-summary-card__item">
                    <span className="label">遅刻 / 早退</span>
                    <span className="value">
                      {detailData.summary.late_count}回 / {detailData.summary.early_leave_count}回
                    </span>
                  </div>
                  <div className="att-user-summary-card__item">
                    <span className="label">非整合打刻</span>
                    <span className="value">{detailData.summary.incomplete_days}回</span>
                  </div>
                </div>
              )}

              <div className="att-table-container">
                <table className="att-table">
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>シフト予定</th>
                      <th>出勤(打刻)</th>
                      <th>退勤(打刻)</th>
                      <th>労働時間</th>
                      <th>時間外</th>
                      <th>状態</th>
                      <th>打刻元</th>
                      <th style={{ minWidth: '180px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderDetailDays(detailData.days)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 修正申請作成モーダル */}
      {showRequestModal && (() => {
        const diff = getRequestDiff();
        return (
          <div className="att-modal" onClick={() => setShowRequestModal(false)}>
            <div className="att-modal__content att-modal__content--wide" onClick={(e) => e.stopPropagation()}>
              <h3 className="att-modal__title">勤怠修正申請</h3>
              
              <div className="att-form-group">
                <label>対象日</label>
                <input type="text" value={requestFormData.workDate} disabled style={{ backgroundColor: '#f6f8fa', cursor: 'not-allowed' }} />
              </div>

              {/* 修正前の情報 */}
              <div className="att-section-box">
                <h4 className="att-section-box__title">修正前の打刻明細</h4>
                <div className="att-section-box__grid">
                  <div className="att-section-box__grid-item">
                    <span className="att-meta-label">出勤:</span>
                    <span className="att-meta-val">{diff.origInStr}</span>
                  </div>
                  <div className="att-section-box__grid-item">
                    <span className="att-meta-label">退勤:</span>
                    <span className="att-meta-val">{diff.origOutStr}</span>
                  </div>
                  <div className="att-section-box__grid-item">
                    <span className="att-meta-label">勤務時間:</span>
                    <span className="att-meta-val">{formatHours(diff.origHours)}</span>
                  </div>
                </div>
              </div>

              {/* 修正後の希望入力 */}
              <div className="att-section-box" style={{ marginTop: '16px' }}>
                <h4 className="att-section-box__title">修正後の希望時間（ローカル時刻）</h4>
                
                <div className="att-form-group">
                  <label className="att-sub-label">出勤希望日時</label>
                  <div className="att-datetime-picker-row">
                    <input
                      type="date"
                      value={requestFormData.requestedCheckInDate}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requestedCheckInDate: e.target.value })
                      }
                      className="att-date-input"
                    />
                    <input
                      type="time"
                      value={requestFormData.requestedCheckInTime}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requestedCheckInTime: e.target.value })
                      }
                      className="att-time-input"
                    />
                    <button
                      type="button"
                      className="att-btn att-btn--link-danger"
                      onClick={() =>
                        setRequestFormData({ ...requestFormData, requestedCheckInDate: '', requestedCheckInTime: '' })
                      }
                      title="出勤日時をクリア"
                    >
                      クリア
                    </button>
                    <button
                      type="button"
                      className="att-btn att-btn--link"
                      onClick={() => {
                        const localIn = toLocalValues(requestFormData.originalCheckIn, requestFormData.workDate);
                        setRequestFormData(prev => ({
                          ...prev,
                          requestedCheckInDate: localIn.date,
                          requestedCheckInTime: localIn.time,
                        }));
                      }}
                      title="修正前の時刻に戻す"
                    >
                      リセット
                    </button>
                  </div>
                </div>

                <div className="att-form-group" style={{ marginTop: '12px' }}>
                  <label className="att-sub-label">退勤希望日時</label>
                  <div className="att-datetime-picker-row">
                    <input
                      type="date"
                      value={requestFormData.requestedCheckOutDate}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requestedCheckOutDate: e.target.value })
                      }
                      className="att-date-input"
                    />
                    <input
                      type="time"
                      value={requestFormData.requestedCheckOutTime}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requestedCheckOutTime: e.target.value })
                      }
                      className="att-time-input"
                    />
                    <button
                      type="button"
                      className="att-btn att-btn--link-danger"
                      onClick={() =>
                        setRequestFormData({ ...requestFormData, requestedCheckOutDate: '', requestedCheckOutTime: '' })
                      }
                      title="退勤日時をクリア"
                    >
                      クリア
                    </button>
                    <button
                      type="button"
                      className="att-btn att-btn--link"
                      onClick={() => {
                        const localOut = toLocalValues(requestFormData.originalCheckOut, requestFormData.workDate);
                        setRequestFormData(prev => ({
                          ...prev,
                          requestedCheckOutDate: localOut.date,
                          requestedCheckOutTime: localOut.time,
                        }));
                      }}
                      title="修正前の時刻に戻す"
                    >
                      リセット
                    </button>
                  </div>
                </div>
              </div>

              {/* 差分比較プレビュー */}
              <div className="att-section-box att-section-box--preview" style={{ marginTop: '16px' }}>
                <h4 className="att-section-box__title">申請内容プレビュー・差分</h4>
                <div className="att-preview-rows">
                  <div className="att-preview-row">
                    <span className="att-preview-label">修正希望時刻：</span>
                    <span className="att-preview-val">
                      {diff.reqInStr} 〜 {diff.reqOutStr}
                    </span>
                  </div>
                  <div className="att-preview-row">
                    <span className="att-preview-label">総勤務時間：</span>
                    <span className="att-preview-val" style={{ fontWeight: 'bold' }}>
                      {formatHours(diff.reqHours)}
                      <span className={`att-diff-badge ${diff.hoursDiff > 0 ? 'att-diff-badge--plus' : diff.hoursDiff < 0 ? 'att-diff-badge--minus' : 'att-diff-badge--zero'}`}>
                        {diff.hoursDiff > 0 ? `+${diff.hoursDiff.toFixed(2)}h` : diff.hoursDiff < 0 ? `${diff.hoursDiff.toFixed(2)}h` : '±0.00h'}
                      </span>
                    </span>
                  </div>
                  {diff.isIncomplete && (
                    <div className="att-preview-warning">
                      ⚠️ 出勤または退勤が空欄のため、不整合打刻（勤務時間0h）として申請されます。
                    </div>
                  )}
                </div>
              </div>

              <div className="att-form-group" style={{ marginTop: '16px' }}>
                <label>
                  修正理由 <span style={{ color: '#d73a49' }}>*</span>
                </label>
                <textarea
                  value={requestFormData.reason}
                  onChange={(e) =>
                    setRequestFormData({ ...requestFormData, reason: e.target.value })
                  }
                  placeholder="修正が必要な理由を入力してください"
                />
              </div>
              <div className="att-modal__buttons">
                <button
                  type="button"
                  className="att-btn att-btn--secondary"
                  onClick={() => setShowRequestModal(false)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="att-btn att-btn--primary"
                  onClick={handleSubmitRequest}
                >
                  申請する
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 承認/却下モーダル */}
      {showApprovalModal && (() => {
        const diff = getApprovalDiff(selectedRequestForApproval);
        return (
          <div className="att-modal" onClick={() => {
            setShowApprovalModal(false);
            setSelectedRequestForApproval(null);
          }}>
            <div className="att-modal__content att-modal__content--wide" onClick={(e) => e.stopPropagation()}>
              <h3 className="att-modal__title">
                {approvalFormData.action === 'approve' ? '申請を承認' : '申請を却下'}
              </h3>

              {selectedRequestForApproval && (
                <div style={{ marginBottom: '20px' }}>
                  {/* 対象者・対象日情報 */}
                  <div className="att-section-box" style={{ marginBottom: '16px' }}>
                    <div className="att-preview-rows">
                      <div className="att-preview-row">
                        <span className="att-preview-label">申請者:</span>
                        <span className="att-preview-val" style={{ fontWeight: 'bold' }}>
                          {selectedRequestForApproval.user_full_name || selectedRequestForApproval.user_name || '未設定'}
                        </span>
                      </div>
                      <div className="att-preview-row">
                        <span className="att-preview-label">対象日:</span>
                        <span className="att-preview-val">{selectedRequestForApproval.work_date}</span>
                      </div>
                      <div className="att-preview-row">
                        <span className="att-preview-label">申請理由:</span>
                        <span className="att-preview-val">{selectedRequestForApproval.reason}</span>
                      </div>
                    </div>
                  </div>

                  {/* 修正前後の比較プレビュー */}
                  <div className="att-approval-grid" style={{ marginBottom: '16px' }}>
                    
                    {/* 修正前 */}
                    <div className="att-section-box">
                      <h4 className="att-section-box__title" style={{ color: '#586069' }}>修正前の打刻明細</h4>
                      <div className="att-preview-rows">
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>出勤:</span>
                          <span className="att-preview-val">{diff.origInStr}</span>
                        </div>
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>退勤:</span>
                          <span className="att-preview-val">{diff.origOutStr}</span>
                        </div>
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>時間:</span>
                          <span className="att-preview-val" style={{ fontWeight: 'bold' }}>{formatHours(diff.origHours)}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: '20px', color: '#888' }}>➔</div>

                    {/* 修正後 */}
                    <div className="att-section-box" style={{ borderColor: '#2188ff', backgroundColor: '#f1f8ff' }}>
                      <h4 className="att-section-box__title" style={{ color: '#0366d6', borderLeftColor: '#2188ff' }}>修正希望時刻</h4>
                      <div className="att-preview-rows">
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>出勤:</span>
                          <span className="att-preview-val" style={{ color: '#24292e', fontWeight: '500' }}>{diff.reqInStr}</span>
                        </div>
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>退勤:</span>
                          <span className="att-preview-val" style={{ color: '#24292e', fontWeight: '500' }}>{diff.reqOutStr}</span>
                        </div>
                        <div className="att-preview-row">
                          <span className="att-preview-label" style={{ width: '45px' }}>時間:</span>
                          <span className="att-preview-val" style={{ fontWeight: 'bold' }}>
                            {formatHours(diff.reqHours)}
                            <span className={`att-diff-badge ${diff.hoursDiff > 0 ? 'att-diff-badge--plus' : diff.hoursDiff < 0 ? 'att-diff-badge--minus' : 'att-diff-badge--zero'}`} style={{ marginLeft: '8px' }}>
                              {diff.hoursDiff > 0 ? `+${diff.hoursDiff.toFixed(2)}h` : diff.hoursDiff < 0 ? `${diff.hoursDiff.toFixed(2)}h` : '±0.00h'}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              <div className="att-form-group">
                <label>
                  コメント
                  {approvalFormData.action === 'reject' && (
                    <span style={{ color: '#d73a49' }}> *必須</span>
                  )}
                </label>
                <textarea
                  value={approvalFormData.comment}
                  onChange={(e) =>
                    setApprovalFormData({ ...approvalFormData, comment: e.target.value })
                  }
                  placeholder={
                    approvalFormData.action === 'approve'
                      ? 'コメント（任意）'
                      : '却下理由を入力してください（必須）'
                  }
                />
              </div>
              <div className="att-modal__buttons">
                <button
                  type="button"
                  className="att-btn att-btn--secondary"
                  onClick={() => {
                    setShowApprovalModal(false);
                    setSelectedRequestForApproval(null);
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="att-btn att-btn--primary"
                  onClick={handleSubmitApproval}
                >
                  {approvalFormData.action === 'approve' ? '承認する' : '却下する'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 変更履歴モーダル */}
      {showHistoryModal && (
        <div className="att-modal" onClick={() => setShowHistoryModal(false)}>
          <div className="att-modal__content att-modal__content--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="att-modal__title">変更履歴 ({historyWorkDate})</h3>
            
            {historyLoading && <div className="att-loading">履歴の読み込み中...</div>}
            {historyError && <div className="att-alert att-alert--danger">{historyError}</div>}
            
            {!historyLoading && !historyError && historyData.length === 0 && (
              <div className="att-empty" style={{ padding: '24px', background: '#f6f8fa', border: '1px solid #eaecef', borderRadius: '6px', textAlign: 'center', color: '#586069' }}>
                変更履歴はありません。
              </div>
            )}
            
            {!historyLoading && !historyError && historyData.length > 0 && (
              <div className="att-history-timeline">
                {historyData.map((entry) => (
                  <div key={entry.id} className="att-history-item" style={{ borderBottom: '1px solid #eaecef', padding: '12px 0' }}>
                    <div className="att-history-meta" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#586069' }}>
                      <span className="att-history-date">
                        {new Date(entry.changed_at).toLocaleString('ja-JP')}
                      </span>
                      <span className={`att-history-role att-history-role--${entry.actor_role}`}>
                        {entry.actor_role === 'admin' ? '管理者' : '従業員'} (ID: {entry.actor_user_id})
                      </span>
                    </div>
                    <div className="att-history-comparison" style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: '#f6f8fa', padding: '8px', borderRadius: '4px', marginBottom: '8px' }}>
                      <div className="att-history-state">
                        <span className="att-meta-label" style={{ color: '#586069' }}>前：</span>
                        <span style={{ color: '#586069' }}>
                          {entry.before.check_in ? formatTime(entry.before.check_in) : '未打刻'} 〜{' '}
                          {entry.before.check_out ? formatTime(entry.before.check_out) : '未打刻'}
                        </span>
                      </div>
                      <div className="att-history-state">
                        <span className="att-meta-label" style={{ color: '#0366d6' }}>後：</span>
                        <span style={{ fontWeight: 'bold' }}>
                          {entry.after.check_in ? formatTime(entry.after.check_in) : '未打刻'} 〜{' '}
                          {entry.after.check_out ? formatTime(entry.after.check_out) : '未打刻'}
                        </span>
                      </div>
                    </div>
                    {entry.reason && (
                      <div className="att-history-reason" style={{ fontSize: '13px', background: '#f9f9f9', padding: '8px', borderLeft: '3px solid #0366d6', borderRadius: '0 4px 4px 0' }}>
                        <strong>理由：</strong>
                        <span>{entry.reason}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="att-modal__buttons" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="att-btn att-btn--secondary"
                onClick={() => setShowHistoryModal(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 勤怠レコード手動追加モーダル (管理者用) */}
      {showAddModal && (
        <div className="att-modal" onClick={() => setShowAddModal(false)}>
          <div className="att-modal__content att-modal__content--wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="att-modal__title">勤怠手動追加</h3>

            <div className="att-form-group">
              <label>対象日</label>
              <input type="text" value={addFormData.workDate} disabled style={{ backgroundColor: '#f6f8fa', cursor: 'not-allowed' }} />
            </div>

            <div className="att-section-box" style={{ marginTop: '16px' }}>
              <h4 className="att-section-box__title">打刻時刻（ローカル時刻）</h4>
              
              <div className="att-form-group">
                <label className="att-sub-label">出勤日時</label>
                <div className="att-datetime-picker-row">
                  <input
                    type="date"
                    value={addFormData.checkInDate}
                    onChange={(e) =>
                      setAddFormData({ ...addFormData, checkInDate: e.target.value })
                    }
                    className="att-date-input"
                  />
                  <input
                    type="time"
                    value={addFormData.checkInTime}
                    onChange={(e) =>
                      setAddFormData({ ...addFormData, checkInTime: e.target.value })
                    }
                    className="att-time-input"
                  />
                  <button
                    type="button"
                    className="att-btn att-btn--link-danger"
                    onClick={() =>
                      setAddFormData({ ...addFormData, checkInDate: '', checkInTime: '' })
                    }
                    title="出勤日時をクリア"
                  >
                    クリア
                  </button>
                </div>
              </div>

              <div className="att-form-group" style={{ marginTop: '12px' }}>
                <label className="att-sub-label">退勤日時</label>
                <div className="att-datetime-picker-row">
                  <input
                    type="date"
                    value={addFormData.checkOutDate}
                    onChange={(e) =>
                      setAddFormData({ ...addFormData, checkOutDate: e.target.value })
                    }
                    className="att-date-input"
                  />
                  <input
                    type="time"
                    value={addFormData.checkOutTime}
                    onChange={(e) =>
                      setAddFormData({ ...addFormData, checkOutTime: e.target.value })
                    }
                    className="att-time-input"
                  />
                  <button
                    type="button"
                    className="att-btn att-btn--link-danger"
                    onClick={() =>
                      setAddFormData({ ...addFormData, checkOutDate: '', checkOutTime: '' })
                    }
                    title="退勤日時をクリア"
                  >
                    クリア
                  </button>
                </div>
              </div>
            </div>

            <div className="att-form-group" style={{ marginTop: '16px' }}>
              <label>
                追加理由 <span style={{ color: '#d73a49' }}>*</span>
              </label>
              <textarea
                value={addFormData.reason}
                onChange={(e) =>
                  setAddFormData({ ...addFormData, reason: e.target.value })
                }
                placeholder="手動で勤怠を追加する理由を入力してください"
              />
            </div>

            <div className="att-modal__buttons">
              <button
                type="button"
                className="att-btn att-btn--secondary"
                onClick={() => setShowAddModal(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="att-btn att-btn--primary"
                onClick={handleSubmitAdd}
              >
                追加する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
