import { useEffect, useState } from 'react';
import { getMonthlyComment, saveMonthlyComment } from '../../api/attendance';
import type { MonthlyComment } from '../../types/attendance';
import { formatUtcDateTime } from '../../utils/time';

interface MonthlyCommentPanelProps {
  token: string;
  yearMonth: string;
}

/** 折りたたみ表示時に表示する最大行数 */
const COLLAPSED_LINE_COUNT = 5;

const emptyComment = (yearMonth: string): MonthlyComment => ({
  year_month: yearMonth,
  body: '',
  updated_by_user_id: null,
  updated_by_name: null,
  updated_at: null,
});

export function MonthlyCommentPanel({ token, yearMonth }: MonthlyCommentPanelProps) {
  const [comment, setComment] = useState<MonthlyComment>(() => emptyComment(yearMonth));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const bodyLines = comment.body ? comment.body.split('\n') : [];
  const isCollapsible = bodyLines.length > COLLAPSED_LINE_COUNT;
  const visibleBody =
    isCollapsible && !expanded ? bodyLines.slice(0, COLLAPSED_LINE_COUNT).join('\n') : comment.body;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsEditing(false);
    setExpanded(false);
    getMonthlyComment(token, yearMonth)
      .then((data) => {
        if (cancelled) return;
        setComment(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'コメントの取得/保存に失敗しました');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, yearMonth]);

  const handleStartEdit = async () => {
    setError(null);
    try {
      const data = await getMonthlyComment(token, yearMonth);
      setComment(data);
      setDraft(data.body);
      setIsEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメントの取得/保存に失敗しました');
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setDraft(comment.body);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      const confirmed = window.confirm('メモを削除しますか？');
      if (!confirmed) {
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveMonthlyComment(token, { year_month: yearMonth, body: draft });
      setComment(result);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメントの取得/保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="att-monthly-comment-panel">
      <div className="att-monthly-comment-panel__header">
        <span className="att-monthly-comment-panel__title">💬 コメント（管理者共有メモ）</span>
        {!isEditing && (
          <span className="att-monthly-comment-panel__meta">
            {comment.updated_at &&
              `最終更新: ${comment.updated_by_name ?? '(退会済みユーザー)'} ${formatUtcDateTime(comment.updated_at)}`}
          </span>
        )}
      </div>

      {error && <div className="att-alert att-alert--danger">{error}</div>}

      {loading ? (
        <div className="att-loading">読み込み中...</div>
      ) : isEditing ? (
        <>
          <textarea
            className="att-monthly-comment-panel__textarea"
            maxLength={2000}
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <div className="att-monthly-comment-panel__actions">
            <button
              type="button"
              className="att-btn att-btn--small att-btn--primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              保存
            </button>
            <button
              type="button"
              className="att-btn att-btn--small att-btn--secondary"
              onClick={handleCancelEdit}
              disabled={saving}
            >
              キャンセル
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="att-monthly-comment-panel__body">
            {comment.body ? (
              <>
                <span style={{ whiteSpace: 'pre-wrap' }}>{visibleBody}</span>
                {isCollapsible && (
                  <button
                    type="button"
                    className="att-monthly-comment-panel__toggle"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                  >
                    {expanded ? '▲ 折りたたむ' : `▼ 続きを表示（全${bodyLines.length}行）`}
                  </button>
                )}
              </>
            ) : (
              <span className="att-monthly-comment-panel__empty">メモはありません</span>
            )}
          </div>
          <div className="att-monthly-comment-panel__actions">
            <button
              type="button"
              className="att-btn att-btn--small att-btn--secondary"
              onClick={() => void handleStartEdit()}
            >
              {comment.body ? '✏️ 編集' : '＋ メモを追加'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
