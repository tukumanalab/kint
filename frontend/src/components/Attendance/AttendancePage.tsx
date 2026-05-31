import { useCallback, useEffect, useState } from 'react';
import {
  getAttendanceSummary,
  getMonthlyAttendanceDetail,
  downloadAttendanceCsv,
} from '../../api/attendance';
import type { UseAuth } from '../../hooks/useAuth';
import type {
  AttendanceMonthlySummary,
  AttendanceMonthlyDetailResponse,
  DailyAttendanceDetail,
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

  const isAdmin = auth.user?.role === 'admin';

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
  }, [auth.token, yearMonth, isAdmin]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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
                      <th>打刻出勤</th>
                      <th>打刻退勤</th>
                      <th>労働時間</th>
                      <th>時間外</th>
                      <th>状態</th>
                      <th>打刻元</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.days.map((day) => {
                      const isAbsence = day.status === 'absence';
                      const isHighlight = day.is_holiday || !day.has_shift;
                      return (
                        <tr
                          key={day.work_date}
                          className={`${isAbsence ? 'tr--absence' : ''} ${isHighlight ? 'tr--holiday' : ''}`}
                        >
                          <td>
                            {day.work_date} {getDayOfWeek(day.work_date)}
                          </td>
                          <td>
                            {day.has_shift && day.shift_start && day.shift_end ? (
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
                                    {formatTime(p.check_in)}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              formatTime(day.check_in)
                            )}
                          </td>
                          <td>
                            {day.punches && day.punches.length > 0 ? (
                              <div className="att-multiple-punches">
                                {day.punches.map((p, idx) => (
                                  <div key={idx} className="att-punch-item">
                                    {formatTime(p.check_out)}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              formatTime(day.check_out)
                            )}
                          </td>
                          <td>{formatHours(day.working_hours)}</td>
                          <td>{formatHours(day.overtime_hours)}</td>
                          <td>{getStatusBadge(day.status)}</td>
                          <td>{getSourceLabel(day.source)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
