import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchAttendanceGuide } from '../../api/docs';
import { MarkdownView } from '../Guide/MarkdownView';
import './AttendancePage.css';
import '../Guide/GuideModal.css';

interface AttendanceGuideModalProps {
  isAdmin: boolean;
  token?: string;
  onClose: () => void;
}

interface GuideSection {
  id: string;
  title: string;
  level: number;
  content: string;
}

export function AttendanceGuideModal({ isAdmin, token, onClose }: AttendanceGuideModalProps) {
  const [markdown, setMarkdown] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('勤怠管理画面 使い方ガイド');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadGuide() {
      if (!token) {
        setLoading(false);
        setError('認証トークンが指定されていません。');
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await fetchAttendanceGuide(token);
        if (isMounted) {
          setDocTitle(data.title);
          setMarkdown(data.content);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'ガイドの読み込みに失敗しました。';
          setError(msg);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadGuide();

    return () => {
      isMounted = false;
    };
  }, [token]);

  // マークダウン文字列を `##` 見出しごとに分解してセクション構造化
  const sections = useMemo<GuideSection[]>(() => {
    if (!markdown) return [];

    const lines = markdown.split(/\r?\n/);
    const result: GuideSection[] = [];
    let currentTitle = '概要';
    let currentId = 'section-0';
    let currentLines: string[] = [];
    let sectionCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        if (currentLines.length > 0) {
          result.push({
            id: currentId,
            title: currentTitle,
            level: 2,
            content: currentLines.join('\n'),
          });
        }
        sectionCount++;
        currentTitle = h2Match[1].trim();
        currentId = `section-${sectionCount}`;
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      result.push({
        id: currentId,
        title: currentTitle,
        level: 2,
        content: currentLines.join('\n'),
      });
    }

    return result;
  }, [markdown]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  // アクティブなセクションのコンテンツ
  const displayContent = useMemo(() => {
    if (activeTabId === 'all') {
      return markdown;
    }
    const targetSection = sections.find((s) => s.id === activeTabId);
    return targetSection ? targetSection.content : markdown;
  }, [activeTabId, markdown, sections]);

  return (
    <dialog
      ref={dialogRef}
      className="myprofile-dialog user-guide-dialog"
      onCancel={onClose}
      onClick={handleBackdropClick}
      style={{
        maxWidth: '900px',
        width: '92%',
        borderRadius: '16px',
        border: 'none',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        background: '#ffffff',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div
        className="user-guide-container"
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', height: '82vh', maxHeight: '700px' }}
      >
        {/* ヘッダー */}
        <div
          className="user-guide-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            color: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📖</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
                {docTitle} ({isAdmin ? '管理者向け' : '従業員向け'})
              </h2>
              <span style={{ fontSize: '0.75rem', opacity: 0.85, display: 'block', marginTop: '2px' }}>
                リポジトリ内の最新のマニュアル (docs/attendance_guide.md) を表示中
              </span>
            </div>
          </div>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background 0.2s',
              fontSize: '0.9rem',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
          >
            ✕
          </button>
        </div>

        {/* メインレイアウト（左タブ、右コンテンツ） */}
        <div className="user-guide-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左サイドバー（タブナビゲーション） */}
          <div
            className="user-guide-sidebar"
            style={{
              width: '240px',
              background: '#f8fafc',
              borderRight: '1px solid #e2e8f0',
              padding: '1rem 0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              overflowY: 'auto',
            }}
          >
            <div style={{ marginBottom: '0.5rem' }}>
              <input
                type="text"
                placeholder="ガイド内を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setActiveTabId('all')}
              className={`guide-tab-btn ${activeTabId === 'all' ? 'active' : ''}`}
              style={getTabStyle(activeTabId === 'all')}
            >
              <span>📑</span> ガイド全文
            </button>

            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', margin: '0.5rem 0.25rem 0.25rem' }}>
              セクション一覧
            </div>

            {sections.map((sec) => {
              // 検索クエリがある場合、タイトルまたは本文にヒットしないものは非表示
              if (
                searchQuery &&
                !sec.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
                !sec.content.toLowerCase().includes(searchQuery.toLowerCase())
              ) {
                return null;
              }

              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveTabId(sec.id)}
                  className={`guide-tab-btn ${activeTabId === sec.id ? 'active' : ''}`}
                  style={getTabStyle(activeTabId === sec.id)}
                >
                  <span style={{ fontSize: '0.9rem' }}>📌</span>
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={sec.title}
                  >
                    {sec.title}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 右メインコンテンツ表示エリア */}
          <div
            className="user-guide-content"
            style={{
              flex: 1,
              padding: '1.75rem 2rem',
              overflowY: 'auto',
              background: '#ffffff',
              lineHeight: '1.65',
              color: '#334155',
              textAlign: 'left',
            }}
          >
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: '#64748b' }}>
                <span className="app-loading">ドキュメントを読み込み中...</span>
              </div>
            ) : error ? (
              <div style={{ padding: '1.5rem', background: '#fef2f2', borderLeft: '4px solid #ef4444', borderRadius: '8px', color: '#991b1b' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>⚠️ 読み込みエラー</h4>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>{error}</p>
              </div>
            ) : (
              <MarkdownView markdown={displayContent} highlight={searchQuery} />
            )}
          </div>
        </div>

        {/* フッター */}
        <div
          className="user-guide-footer"
          style={{
            padding: '0.75rem 1.5rem',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            💡 お困りの際は「検索」または左側の各セクションタブから操作方法を確認できます。
          </span>
          <button
            type="button"
            className="att-btn att-btn--secondary"
            onClick={onClose}
            style={{ padding: '0.4rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}

// タブ選択時の動的スタイリング用ヘルパー
function getTabStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.6rem 0.75rem',
    border: 'none',
    borderRadius: '8px',
    background: isActive ? '#dbeafe' : 'transparent',
    color: isActive ? '#1d4ed8' : '#475569',
    fontWeight: isActive ? '600' : '500',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: '0.85rem',
    width: '100%',
  };
}
