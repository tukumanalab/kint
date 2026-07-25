import { useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import { fetchAttendanceGuide } from '../../api/docs';
import './AttendancePage.css';

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

// GitHub Alert の種類とスタイル設定
const ALERT_STYLES: Record<string, { bg: string; border: string; text: string; icon: string; title: string }> = {
  NOTE: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', icon: 'ℹ️', title: 'ノート' },
  TIP: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', icon: '💡', title: 'ヒント' },
  IMPORTANT: { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8', icon: '📌', title: '重要' },
  WARNING: { bg: '#fffbeb', border: '#f59e0b', text: '#b45309', icon: '⚠️', title: '注意' },
  CAUTION: { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c', icon: '🚨', title: '警告' },
};

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
              <SimpleMarkdownViewer markdownText={displayContent} searchQuery={searchQuery} />
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

// マークダウンテキストを HTML 要素群にパースして安全に描画する簡易レンダラー
function SimpleMarkdownViewer({ markdownText, searchQuery }: { markdownText: string; searchQuery: string }) {
  const elements = useMemo(() => {
    if (!markdownText) return [];

    const lines = markdownText.split(/\r?\n/);
    const parsedNodes: ReactNode[] = [];
    let keyIdx = 0;

    let inTable = false;
    let tableHeader: string[] = [];
    let tableRows: string[][] = [];

    let inAlert = false;
    let alertType = 'NOTE';
    let alertLines: string[] = [];

    let inList = false;
    let listItems: string[] = [];

    const flushTable = () => {
      if (!inTable) return;
      parsedNodes.push(
        <div key={`table-${keyIdx++}`} style={{ overflowX: 'auto', margin: '1rem 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                {tableHeader.map((h, idx) => (
                  <th key={idx} style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontWeight: '600', color: '#1e293b' }}>
                    {renderInlineText(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rIdx) => (
                <tr key={rIdx} style={{ borderBottom: '1px solid #e2e8f0', background: rIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} style={{ padding: '0.6rem 0.8rem', verticalAlign: 'top' }}>
                      {renderInlineText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableHeader = [];
      tableRows = [];
    };

    const flushAlert = () => {
      if (!inAlert) return;
      const config = ALERT_STYLES[alertType] || ALERT_STYLES.NOTE;
      parsedNodes.push(
        <div
          key={`alert-${keyIdx++}`}
          style={{
            padding: '0.9rem 1.1rem',
            borderRadius: '8px',
            background: config.bg,
            borderLeft: `4px solid ${config.border}`,
            color: config.text,
            fontSize: '0.88rem',
            margin: '1rem 0',
          }}
        >
          <div style={{ fontWeight: '700', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>{config.icon}</span>
            <span>{config.title}</span>
          </div>
          {alertLines.map((aLine, aIdx) => (
            <div key={aIdx} style={{ marginTop: aIdx > 0 ? '0.25rem' : 0 }}>
              {renderInlineText(aLine)}
            </div>
          ))}
        </div>
      );
      inAlert = false;
      alertType = 'NOTE';
      alertLines = [];
    };

    const flushList = () => {
      if (!inList) return;
      parsedNodes.push(
        <ul key={`list-${keyIdx++}`} style={{ paddingLeft: '1.4rem', margin: '0.75rem 0', fontSize: '0.9rem' }}>
          {listItems.map((item, lIdx) => (
            <li key={lIdx} style={{ marginBottom: '0.35rem' }}>
              {renderInlineText(item)}
            </li>
          ))}
        </ul>
      );
      inList = false;
      listItems = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();

      // GitHub Alert の開始判定 (> [!NOTE] 等)
      const alertMatch = line.match(/^>\s*\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION)\]/i);
      if (alertMatch) {
        flushTable();
        flushList();
        flushAlert();
        inAlert = true;
        alertType = alertMatch[1].toUpperCase();
        alertLines = [];
        continue;
      }

      if (inAlert) {
        if (line.startsWith('>')) {
          alertLines.push(line.replace(/^>\s?/, ''));
          continue;
        } else {
          flushAlert();
        }
      }

      // テーブルの処理
      if (line.startsWith('|') && line.endsWith('|')) {
        flushList();
        flushAlert();
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());

        // テーブル区切り行 (| :--- | :--- |) はスキップ
        if (cells.every((c) => /^:?-+:?$/.test(c))) {
          continue;
        }

        if (!inTable) {
          inTable = true;
          tableHeader = cells;
        } else {
          tableRows.push(cells);
        }
        continue;
      } else if (inTable) {
        flushTable();
      }

      // 箇条書きリスト
      const listMatch = line.match(/^(\*|-|\d+\.)\s+(.+)$/);
      if (listMatch) {
        flushTable();
        flushAlert();
        inList = true;
        listItems.push(listMatch[2]);
        continue;
      } else if (inList) {
        flushList();
      }

      // 空行
      if (line.trim() === '') {
        continue;
      }

      // 水平線 (---)
      if (/^---{3,}$/.test(line.trim())) {
        parsedNodes.push(
          <hr key={`hr-${keyIdx++}`} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '1.5rem 0' }} />
        );
        continue;
      }

      // 見出し H1
      if (line.startsWith('# ')) {
        parsedNodes.push(
          <h1 key={`h1-${keyIdx++}`} style={{ fontSize: '1.4rem', fontWeight: '800', color: '#0f172a', margin: '0 0 1rem 0' }}>
            {renderInlineText(line.slice(2))}
          </h1>
        );
        continue;
      }

      // 見出し H2
      if (line.startsWith('## ')) {
        parsedNodes.push(
          <h2
            key={`h2-${keyIdx++}`}
            style={{
              fontSize: '1.2rem',
              fontWeight: '700',
              color: '#1e293b',
              margin: '1.5rem 0 0.75rem 0',
              paddingBottom: '0.4rem',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            {renderInlineText(line.slice(3))}
          </h2>
        );
        continue;
      }

      // 見出し H3
      if (line.startsWith('### ')) {
        parsedNodes.push(
          <h3 key={`h3-${keyIdx++}`} style={{ fontSize: '1.05rem', fontWeight: '600', color: '#334155', margin: '1.25rem 0 0.5rem 0' }}>
            {renderInlineText(line.slice(4))}
          </h3>
        );
        continue;
      }

      // 見出し H4
      if (line.startsWith('#### ')) {
        parsedNodes.push(
          <h4 key={`h4-${keyIdx++}`} style={{ fontSize: '0.95rem', fontWeight: '600', color: '#475569', margin: '1rem 0 0.4rem 0' }}>
            {renderInlineText(line.slice(5))}
          </h4>
        );
        continue;
      }

      // 通常段落
      parsedNodes.push(
        <p key={`p-${keyIdx++}`} style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#334155' }}>
          {renderInlineText(line)}
        </p>
      );
    }

    flushTable();
    flushAlert();
    flushList();

    return parsedNodes;
  }, [markdownText]);

  // インライン装飾（太字・コード・ハイライトなど）のレンダリング
  function renderInlineText(text: string): ReactNode {
    if (!text) return null;

    // 太字 **bold** や `code` を変換する簡単なトークナイザ
    const parts: ReactNode[] = [];
    let remaining = text;
    let idx = 0;

    while (remaining.length > 0) {
      // 太字 **text**
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      // コード `text`
      const codeMatch = remaining.match(/`(.+?)`/);

      let firstMatchIndex = Infinity;
      let matchType: 'bold' | 'code' | null = null;
      let matchObj: RegExpMatchArray | null = null;

      if (boldMatch && boldMatch.index !== undefined && boldMatch.index < firstMatchIndex) {
        firstMatchIndex = boldMatch.index;
        matchType = 'bold';
        matchObj = boldMatch;
      }

      if (codeMatch && codeMatch.index !== undefined && codeMatch.index < firstMatchIndex) {
        firstMatchIndex = codeMatch.index;
        matchType = 'code';
        matchObj = codeMatch;
      }

      if (!matchType || !matchObj || firstMatchIndex === Infinity) {
        parts.push(highlightSearchText(remaining, searchQuery, idx++));
        break;
      }

      // マッチ前のプレーンテキスト
      if (firstMatchIndex > 0) {
        const plain = remaining.slice(0, firstMatchIndex);
        parts.push(highlightSearchText(plain, searchQuery, idx++));
      }

      // マッチ要素
      const content = matchObj[1];
      if (matchType === 'bold') {
        parts.push(
          <strong key={`b-${idx++}`} style={{ fontWeight: '700', color: '#0f172a' }}>
            {highlightSearchText(content, searchQuery, idx++)}
          </strong>
        );
      } else if (matchType === 'code') {
        parts.push(
          <code
            key={`c-${idx++}`}
            style={{
              background: '#f1f5f9',
              color: '#0f172a',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              fontSize: '0.85em',
              fontFamily: 'monospace',
            }}
          >
            {highlightSearchText(content, searchQuery, idx++)}
          </code>
        );
      }

      remaining = remaining.slice(firstMatchIndex + matchObj[0].length);
    }

    return <>{parts}</>;
  }

  // 検索ヒット箇所のハイライト表示
  function highlightSearchText(text: string, query: string, keyPrefix: number): ReactNode {
    if (!query || !query.trim()) return text;

    const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={`hl-${keyPrefix}-${i}`} style={{ background: '#fef08a', color: '#854d0e', padding: '0 2px', borderRadius: '2px' }}>
          {part}
        </mark>
      ) : (
        part
      )
    );
  }

  function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return <div>{elements}</div>;
}
