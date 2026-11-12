/** ガイド表示用の簡易マークダウン解析。HTML は生成せず、ブロックの木構造だけを返す。 */

export type AlertKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

export interface ListItem {
  /** 項目本文（継続行は改行で連結）。 */
  text: string;
  children: ListBlock[];
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'hr' }
  | { type: 'code'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; alert: AlertKind | null; blocks: Block[] }
  | ListBlock;

export interface GuideSection {
  id: string;
  title: string;
  /** 見出し行を含まない本文。 */
  body: string;
}

const LIST_RE = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

function indentWidth(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 1;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

function isTableDivider(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

interface RawItem {
  indent: number;
  ordered: boolean;
  start: number;
  lines: string[];
}

/** インデントの深さから入れ子のリストを組み立てる。 */
function buildList(rawItems: RawItem[]): ListBlock {
  const makeList = (item: RawItem): ListBlock => ({
    type: 'list',
    ordered: item.ordered,
    start: item.start,
    items: [],
  });

  const root = makeList(rawItems[0]);
  const stack: { list: ListBlock; indent: number }[] = [{ list: root, indent: rawItems[0].indent }];

  for (const raw of rawItems) {
    // 現在位置より浅い項目が来たら、その深さのリストまで戻る
    while (stack.length > 1 && raw.indent < stack[stack.length - 1].indent) {
      stack.pop();
    }
    let top = stack[stack.length - 1];
    const lastItem = top.list.items[top.list.items.length - 1];
    if (raw.indent >= top.indent + 2 && lastItem) {
      const nested = makeList(raw);
      lastItem.children.push(nested);
      stack.push({ list: nested, indent: raw.indent });
      top = stack[stack.length - 1];
    }
    top.list.items.push({ text: raw.lines.join('\n'), children: [] });
  }

  return root;
}

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // コードブロック
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    // 見出し
    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2],
      });
      i += 1;
      continue;
    }

    // 水平線
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 引用・GitHub Alert
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      let alert: AlertKind | null = null;
      const first = inner[0]?.match(ALERT_RE);
      if (first) {
        alert = first[1].toUpperCase() as AlertKind;
        inner.shift();
      }
      blocks.push({ type: 'quote', alert, blocks: parseMarkdown(inner.join('\n')) });
      continue;
    }

    // テーブル
    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const body = rows.filter((r) => !isTableDivider(r));
      if (body.length > 0) {
        blocks.push({ type: 'table', header: body[0], rows: body.slice(1) });
      }
      continue;
    }

    // リスト（入れ子・番号付き・継続行に対応）
    if (LIST_RE.test(line)) {
      const rawItems: RawItem[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = cur.match(LIST_RE);
        if (m) {
          const marker = m[2];
          const ordered = /\d/.test(marker);
          // 同じ深さで「番号付き」と「箇条書き」が切り替わったら、別のリストとして扱う
          const root = rawItems[0];
          if (root && indentWidth(m[1]) < root.indent + 2 && ordered !== root.ordered) {
            break;
          }
          rawItems.push({
            indent: indentWidth(m[1]),
            ordered,
            start: ordered ? parseInt(marker, 10) : 1,
            lines: [m[3]],
          });
          i += 1;
          continue;
        }
        if (cur.trim() === '') {
          // 空行の次もリストが続くなら同じリストとして扱う
          const next = lines[i + 1];
          if (next !== undefined && LIST_RE.test(next)) {
            i += 1;
            continue;
          }
          break;
        }
        // インデントされた継続行は直前の項目に含める
        if (indentWidth(cur) >= 2 && !isTableRow(cur) && !/^\s*>/.test(cur)) {
          rawItems[rawItems.length - 1].lines.push(cur.trim());
          i += 1;
          continue;
        }
        break;
      }
      blocks.push(buildList(rawItems));
      continue;
    }

    // 段落（空行または別種のブロックが始まるまで）
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (
        cur.trim() === '' ||
        HEADING_RE.test(cur) ||
        HR_RE.test(cur) ||
        LIST_RE.test(cur) ||
        isTableRow(cur) ||
        /^\s*>/.test(cur) ||
        /^\s*```/.test(cur)
      ) {
        break;
      }
      para.push(cur.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: para });
  }

  return blocks;
}

/** マークダウンを `##` 見出しごとのセクションに分ける。最初の `##` より前は intro として返す。 */
export function splitSections(markdown: string): { intro: string; sections: GuideSection[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const intro: string[] = [];
  const sections: GuideSection[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let inCode = false;

  const flush = () => {
    if (!current) return;
    sections.push({
      id: `section-${sections.length + 1}`,
      title: current.title,
      body: current.lines.join('\n').replace(/\n\s*---+\s*$/, '\n').trim(),
    });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const h2 = !inCode ? line.match(/^##\s+(.+?)\s*#*$/) : null;
    if (h2) {
      flush();
      current = { title: h2[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  flush();

  return {
    intro: intro
      .join('\n')
      .replace(/\n\s*---+\s*$/, '\n')
      .trim(),
    sections,
  };
}
