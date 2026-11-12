import { describe, expect, it } from 'vitest';
import { parseMarkdown, splitSections, type Block, type ListBlock } from './markdown';

function firstList(blocks: Block[]): ListBlock {
  const list = blocks.find((b) => b.type === 'list');
  if (!list || list.type !== 'list') throw new Error('list not found');
  return list;
}

describe('parseMarkdown', () => {
  it('--- を水平線として扱い、文字のまま残さない', () => {
    const blocks = parseMarkdown('前の段落\n\n---\n\n## 見出し');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'hr', 'heading']);
  });

  it('インデントされた項目を入れ子のリストにする', () => {
    const md = [
      '1. 一覧から **「修正申請」** をクリックします。',
      '   - 複数打刻がある場合は対象を選びます。',
      '2. 情報を入力します。',
      '   - **出勤希望時刻**: 正しい時刻',
      '     - 出勤のみの修正も可能です。',
      '3. 申請します。',
    ].join('\n');
    const list = firstList(parseMarkdown(md));

    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(list.items[0].children[0].ordered).toBe(false);
    expect(list.items[0].children[0].items[0].text).toContain('複数打刻');
    // 3段目まで入れ子になる
    expect(list.items[1].children[0].items[0].children[0].items[0].text).toContain('出勤のみ');
    expect(list.items[2].text).toBe('申請します。');
  });

  it('「*   」形式の箇条書きとその入れ子を解釈する', () => {
    const md = ['*   **申請勤務時間**:', '    *   30分単位で切り上げた時間です。', '*   **総勤務時間**:'].join(
      '\n',
    );
    const list = firstList(parseMarkdown(md));
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[0].children[0].items[0].text).toContain('30分単位');
  });

  it('番号付きリストの直後の箇条書きは別のリストにする', () => {
    const md = ['1. 手順その1', '2. 手順その2', '', '- 補足その1', '- 補足その2'].join('\n');
    const lists = parseMarkdown(md).filter((b): b is ListBlock => b.type === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0].ordered).toBe(true);
    expect(lists[0].items).toHaveLength(2);
    expect(lists[1].ordered).toBe(false);
    expect(lists[1].items).toHaveLength(2);
  });

  it('GitHub Alert と通常の引用を区別する', () => {
    const md = ['> [!WARNING]', '> **締め処理中の制限**', '> 編集できません。', '', '> ただの引用です。'].join(
      '\n',
    );
    const quotes = parseMarkdown(md).filter((b) => b.type === 'quote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ alert: 'WARNING' });
    expect(quotes[1]).toMatchObject({ alert: null });
  });

  it('Alert の中の箇条書きもリストとして解釈する', () => {
    const md = ['> [!NOTE]', '> - 1つ目', '> - 2つ目'].join('\n');
    const quote = parseMarkdown(md)[0];
    if (quote.type !== 'quote') throw new Error('quote expected');
    expect(firstList(quote.blocks).items).toHaveLength(2);
  });

  it('テーブルの区切り行を除いてヘッダーと行を取り出す', () => {
    const md = ['| 表示 | 意味 |', '| :--- | :--- |', '| **正常** | 問題なし |', '| **欠勤** | 打刻なし |'].join(
      '\n',
    );
    const table = parseMarkdown(md)[0];
    expect(table).toEqual({
      type: 'table',
      header: ['表示', '意味'],
      rows: [
        ['**正常**', '問題なし'],
        ['**欠勤**', '打刻なし'],
      ],
    });
  });

  it('連続する行は1つの段落にまとめる', () => {
    const blocks = parseMarkdown('1行目です。\n2行目です。\n\n別の段落です。');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: ['1行目です。', '2行目です。'] },
      { type: 'paragraph', lines: ['別の段落です。'] },
    ]);
  });
});

describe('splitSections', () => {
  it('## 見出しごとに分け、区切りの --- は本文に含めない', () => {
    const md = ['# タイトル', '', '導入文です。', '', '---', '', '## 最初', '本文A', '', '---', '', '## 次', '本文B'].join(
      '\n',
    );
    const { intro, sections } = splitSections(md);
    expect(intro).toBe('# タイトル\n\n導入文です。');
    expect(sections.map((s) => s.title)).toEqual(['最初', '次']);
    expect(sections[0].body).toBe('本文A');
    expect(sections[1].body).toBe('本文B');
  });
});
