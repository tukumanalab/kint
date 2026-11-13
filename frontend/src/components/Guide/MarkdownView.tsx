import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type AlertKind, type Block, type ListBlock } from './markdown';
import './MarkdownView.css';

interface Props {
  markdown: string;
  /** 一致箇所をハイライトする検索語（任意）。 */
  highlight?: string;
}

const ALERT_LABELS: Record<AlertKind, { icon: string; title: string }> = {
  NOTE: { icon: 'ℹ️', title: 'メモ' },
  TIP: { icon: '💡', title: 'ヒント' },
  IMPORTANT: { icon: '📌', title: '重要' },
  WARNING: { icon: '⚠️', title: '注意' },
  CAUTION: { icon: '🚨', title: '警告' },
};

const INLINE_RE = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, query: string, keyBase: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={`${keyBase}-${i}`} className="md-mark">
        {part}
      </mark>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    ),
  );
}

/** 太字・コード・リンクを含む1行分のテキストを描画する。 */
function renderInline(text: string, query: string, keyBase: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) {
      nodes.push(highlightText(text.slice(last, at), query, `${keyBase}-t${idx}`));
    }
    const key = `${keyBase}-m${idx}`;
    if (m[2] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(m[2], query, key)}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={key} className="md-code">
          {highlightText(m[3], query, key)}
        </code>,
      );
    } else if (m[4] !== undefined && m[5] !== undefined) {
      nodes.push(
        <a key={key} href={m[5]} target="_blank" rel="noopener noreferrer">
          {highlightText(m[4], query, key)}
        </a>,
      );
    }
    last = at + m[0].length;
    idx += 1;
  }
  if (last < text.length) {
    nodes.push(highlightText(text.slice(last), query, `${keyBase}-t${idx}`));
  }
  return nodes;
}

function renderLines(lines: string[], query: string, keyBase: string): ReactNode {
  return lines.map((line, i) => (
    <Fragment key={`${keyBase}-l${i}`}>
      {i > 0 && <br />}
      {renderInline(line, query, `${keyBase}-l${i}`)}
    </Fragment>
  ));
}

function renderList(list: ListBlock, query: string, keyBase: string): ReactNode {
  const items = list.items.map((item, i) => (
    <li key={`${keyBase}-i${i}`}>
      {renderLines(item.text.split('\n'), query, `${keyBase}-i${i}`)}
      {item.children.map((child, c) => renderList(child, query, `${keyBase}-i${i}-c${c}`))}
    </li>
  ));
  return list.ordered ? (
    <ol key={keyBase} className="md-list" start={list.start}>
      {items}
    </ol>
  ) : (
    <ul key={keyBase} className="md-list">
      {items}
    </ul>
  );
}

function renderBlocks(blocks: Block[], query: string, keyBase: string): ReactNode {
  return blocks.map((block, i) => {
    const key = `${keyBase}-${i}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4';
        return (
          <Tag key={key} className={`md-h md-h${block.level}`}>
            {renderInline(block.text, query, key)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="md-p">
            {renderLines(block.lines, query, key)}
          </p>
        );
      case 'hr':
        return <hr key={key} className="md-hr" />;
      case 'code':
        return (
          <pre key={key} className="md-pre">
            <code>{block.text}</code>
          </pre>
        );
      case 'list':
        return renderList(block, query, key);
      case 'table':
        return (
          <div key={key} className="md-table-wrap">
            <table className={`md-table ${block.header.length >= 3 ? 'md-table--wide' : ''}`}>
              <thead>
                <tr>
                  {block.header.map((h, c) => (
                    <th key={c}>{renderInline(h, query, `${key}-h${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{renderInline(cell, query, `${key}-r${r}c${c}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'quote':
        if (block.alert) {
          const label = ALERT_LABELS[block.alert];
          return (
            <div key={key} className={`md-alert md-alert--${block.alert.toLowerCase()}`}>
              <div className="md-alert__title">
                <span aria-hidden="true">{label.icon}</span>
                <span>{label.title}</span>
              </div>
              {renderBlocks(block.blocks, query, key)}
            </div>
          );
        }
        return (
          <blockquote key={key} className="md-quote">
            {renderBlocks(block.blocks, query, key)}
          </blockquote>
        );
      default:
        return null;
    }
  });
}

/** マークダウン文字列を React 要素として安全に描画する（HTML は解釈しない）。 */
export function MarkdownView({ markdown, highlight = '' }: Props) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return <div className="md">{renderBlocks(blocks, highlight, 'md')}</div>;
}
