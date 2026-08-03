import { useEffect, useRef, useState } from 'react';
import { fetchWorkingHoursReport } from '../../api/working_hours_report';
import type {
  WorkingHoursReportResponse,
  WorkingHoursReportDayItem,
} from '../../types/working_hours_report';
import './WorkingHoursReportModal.css';

interface Props {
  token: string;
  yearMonth: string;
  userId?: string;
  onClose: () => void;
}

export function WorkingHoursReportModal({ token, yearMonth, userId, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<WorkingHoursReportResponse | null>(null);
  const [days, setDays] = useState<WorkingHoursReportDayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 一括変更用勤務内容
  const [bulkWorkContent, setBulkWorkContent] = useState('');

  useEffect(() => {
    let ignore = false;
    fetchWorkingHoursReport(token, yearMonth, userId)
      .then((data) => {
        if (!ignore) {
          setReport(data);
          setDays(data.days);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err.message || '勤務時間報告書の取得に失敗しました');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [token, yearMonth, userId]);

  function handleDayChange(index: number, field: 'work_content' | 'remarks', value: string) {
    setDays((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleApplyBulkWorkContent() {
    if (!bulkWorkContent.trim()) return;
    setDays((prev) =>
      prev.map((item) =>
        item.start_time || item.end_time
          ? { ...item, work_content: bulkWorkContent }
          : item
      )
    );
  }

  function handlePrint() {
    const sheetEl = sheetRef.current;
    if (!sheetEl) return;

    // input 要素の値を print-text span に同期してからクローン
    sheetEl.querySelectorAll('.print-text').forEach((span) => {
      const input = span.previousElementSibling as HTMLInputElement | null;
      if (input && input.classList.contains('report-table-input')) {
        span.textContent = input.value || '';
      }
    });

    // 既存の印刷用 iframe があれば削除
    const existingIframe = document.getElementById('working-hours-report-print-iframe');
    if (existingIframe) {
      existingIframe.remove();
    }

    // 隠し iframe の作成
    const iframe = document.createElement('iframe');
    iframe.id = 'working-hours-report-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const pri = iframe.contentWindow;
    if (!pri) return;

    // 現在のページのスタイルシートを収集
    const stylesheets = Array.from(document.styleSheets)
      .map((ss) => {
        try {
          return Array.from(ss.cssRules).map((r) => r.cssText).join('\n');
        } catch {
          // cross-origin stylesheet — link タグとしてコピー
          return ss.href ? `@import url("${ss.href}");` : '';
        }
      })
      .join('\n');

    pri.document.open();
    pri.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>勤務時間報告書</title>
<style>
${stylesheets}

/* 印刷用の input 非表示＆ print-text 表示 */
.report-table-input { display: none !important; }
.print-text { display: inline !important; }

/* A4 1枚固定 */
@page {
  size: A4 portrait;
  margin: 0;
}
html, body {
  margin: 0;
  padding: 0;
  width: 210mm;
  background: #ffffff;
}
.working-report-sheet {
  width: 210mm;
  max-height: 297mm;
  padding: 6mm 10mm 4mm 10mm;
  box-sizing: border-box;
  overflow: hidden;
  background: #ffffff;
}
</style>
</head>
<body>
${sheetEl.outerHTML}
</body>
</html>`);
    pri.document.close();

    const doPrint = () => {
      pri.focus();
      // 印刷/保存完了またはキャンセル後に iframe を破棄
      pri.onafterprint = () => {
        iframe.remove();
      };
      pri.print();
    };

    if (pri.document.readyState === 'complete') {
      doPrint();
    } else {
      pri.addEventListener('load', doPrint, { once: true });
    }
  }

  if (loading) {
    return (
      <div className="report-modal-backdrop" onClick={onClose}>
        <div className="report-modal-container" onClick={(e) => e.stopPropagation()}>
          <div className="report-modal__loading">勤務時間報告書を読み込み中...</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="report-modal-backdrop" onClick={onClose}>
        <div className="report-modal-container" onClick={(e) => e.stopPropagation()}>
          <div className="report-modal__error">
            <p>{error || 'データの読み込みに失敗しました'}</p>
            <button type="button" className="report-btn report-btn--secondary" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-modal-backdrop" onClick={onClose}>
      <div className="report-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* 操作用バー（印刷時に非表示） */}
        <div className="report-modal-toolbar no-print">
          <div className="report-modal-toolbar__bulk">
            <input
              type="text"
              className="report-input report-input--bulk"
              placeholder="勤務内容の一括変更..."
              value={bulkWorkContent}
              onChange={(e) => setBulkWorkContent(e.target.value)}
            />
            <button
              type="button"
              className="report-btn report-btn--secondary"
              onClick={handleApplyBulkWorkContent}
            >
              一括適用
            </button>
          </div>
          <div className="report-modal-toolbar__actions">
            <button type="button" className="report-btn report-btn--primary" onClick={handlePrint}>
              🖨️ 印刷 / PDF保存
            </button>
            <button type="button" className="report-btn report-btn--secondary" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>

        {/* 帳票本体（印刷対象） */}
        <div className="working-report-sheet" ref={sheetRef}>
          <h1 className="working-report-title">{report.title}</h1>

          {/* ヘッダーブロック */}
          <div className="working-report-header">
            <table className="working-report-header-table">
              <tbody>
                <tr>
                  <td className="header-label">所属</td>
                  <td className="header-value department-cell" colSpan={2}>
                    {report.user.department || ''}
                  </td>
                  <td className="header-label day-check-header" colSpan={6}>
                    所定の出勤曜日（該当欄に○）
                  </td>
                </tr>
                <tr>
                  <td className="header-label">カナ</td>
                  <td className="header-value kana-worker-id-cell">
                    <div className="kana-worker-id-inner">
                      <span className="kana-value">{report.user.name_kana || ''}</span>
                      <span className="worker-id-value">{report.user.worker_id || ''}</span>
                    </div>
                  </td>
                  <td className="seal-cell" rowSpan={2}>
                    ㊞
                  </td>
                  <td className="day-cell day-cell--header day-cell--first">月</td>
                  <td className="day-cell day-cell--header">火</td>
                  <td className="day-cell day-cell--header">水</td>
                  <td className="day-cell day-cell--header">木</td>
                  <td className="day-cell day-cell--header">金</td>
                  <td className="day-cell day-cell--header day-cell--last">土</td>
                </tr>
                <tr>
                  <td className="header-label font-small">
                    パートタイム職員<br />氏 名
                  </td>
                  <td className="header-value full-name-cell">
                    {report.user.full_name}
                  </td>
                  <td className="day-cell day-cell--box day-cell--first"></td>
                  <td className="day-cell day-cell--box"></td>
                  <td className="day-cell day-cell--box"></td>
                  <td className="day-cell day-cell--box"></td>
                  <td className="day-cell day-cell--box"></td>
                  <td className="day-cell day-cell--box day-cell--last"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 明細テーブル */}
          <table className="working-report-main-table">
            <thead>
              <tr>
                <th className="col-date">日付<br />(曜日)</th>
                <th className="col-time">勤 務 時 間</th>
                <th className="col-break">休 憩<br />時間数</th>
                <th className="col-actual">実働<br />時間数</th>
                <th className="col-content">勤 務 内 容</th>
                <th className="col-remarks">備 考</th>
              </tr>
            </thead>
            <tbody>
              {days.map((item, index) => (
                <tr key={index} className={item.is_weekend ? 'weekend-row' : ''}>
                  <td className="cell-center">{item.day_of_week_label}</td>
                  <td className="cell-center time-cell">
                    {item.start_time && item.end_time ? (
                      `${item.start_time} 〜 ${item.end_time}`
                    ) : item.start_time ? (
                      `${item.start_time} 〜`
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="cell-center">{item.break_time_str || ''}</td>
                  <td className="cell-center">{item.actual_work_time_str || ''}</td>
                  <td className="cell-left content-cell">
                    <input
                      type="text"
                      className="report-table-input"
                      value={item.work_content || ''}
                      onChange={(e) => handleDayChange(index, 'work_content', e.target.value)}
                    />
                    <span className="print-text">{item.work_content || ''}</span>
                  </td>
                  <td className="cell-left remarks-cell">
                    <input
                      type="text"
                      className="report-table-input"
                      value={item.remarks || ''}
                      onChange={(e) => handleDayChange(index, 'remarks', e.target.value)}
                    />
                    <span className="print-text">{item.remarks || ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="summary-row">
                <td colSpan={2} className="summary-label">
                  合 計 時 間 数
                </td>
                <td colSpan={2} className="summary-value-actual">
                  {report.total_actual_work_time_str}
                </td>
                <td colSpan={2} className="summary-empty"></td>
              </tr>
              <tr className="summary-row">
                <td colSpan={2} className="summary-label">
                  計 算 欄
                </td>
                <td colSpan={2} className="summary-value-requested">
                  {report.total_requested_work_hours.toFixed(1)}
                </td>
                <td colSpan={2} className="summary-empty"></td>
              </tr>
            </tfoot>
          </table>

          {/* 勤務監督者 押印枠 (右側) */}
          <div className="supervisor-seal-container">
            <div className="supervisor-seal-box">
              <div className="supervisor-seal-title">勤務監督者</div>
              <div className="supervisor-seal-circle">㊞</div>
            </div>
          </div>

          {/* 下部 経理課使用欄 */}
          <div className="accounting-section">
            <div className="accounting-title">以下、経理課使用欄</div>
            <div className="accounting-grid">
              <div className="accounting-row">
                <span>単価＠ __________________ 円 × 時間数 __________________ ｈ ＝ __________________ 円</span>
                <span className="tax-type">税区分  月甲  月乙  日丙</span>
              </div>
              <div className="accounting-row accounting-row--aligned">
                <span className="aligned-tax">源泉所得税額 __________________ 円</span>
              </div>
              <div className="accounting-row accounting-row--aligned">
                <span className="aligned-pay">差引支給額 __________________ 円</span>
                <span className="request-no">執行依頼書№ ___________________________</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
