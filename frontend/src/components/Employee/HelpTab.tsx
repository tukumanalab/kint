import { useEffect, useMemo, useState } from 'react';
import { fetchEmployeeGuide } from '../../api/docs';
import { MarkdownView } from '../Guide/MarkdownView';
import { splitSections } from '../Guide/markdown';
import { ChevronDownIcon } from './icons';

interface Props {
  token: string;
}

/** ヘルプタブ: 従業員向けガイドを見出しごとに折りたたんで表示する。 */
export function HelpTab({ token }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    fetchEmployeeGuide(token)
      .then((res) => {
        if (active) setMarkdown(res.content);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'ガイドを読み込めませんでした');
      });
    return () => {
      active = false;
    };
  }, [token]);

  const { intro, sections } = useMemo(() => splitSections(markdown ?? ''), [markdown]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? sections.filter(
            (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
          )
        : sections,
    [sections, q],
  );

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 見出し（# ...）は画面タイトルと重複するので本文からは除く
  const introBody = intro.replace(/^#\s+.*$/m, '').trim();

  return (
    <div className="emp-page">
      <header className="emp-page__head">
        <h1 className="emp-page__title">使い方ガイド</h1>
      </header>

      {error && (
        <div className="emp-alert emp-alert--danger" role="alert">
          {error}
        </div>
      )}
      {!error && markdown === null && <div className="emp-skeleton emp-skeleton--list" />}

      {markdown !== null && (
        <>
          {introBody && !q && (
            <div className="emp-help-intro">
              <MarkdownView markdown={introBody} />
            </div>
          )}

          <input
            type="search"
            className="emp-input emp-search"
            placeholder="キーワードで探す（例: 打刻もれ）"
            aria-label="ガイド内を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {visible.length === 0 ? (
            <p className="emp-empty">「{query}」に一致する項目はありません。</p>
          ) : (
            <div className="emp-accordion">
              {visible.map((s) => {
                // 検索中は一致した項目をすべて開いた状態で見せる
                const open = q ? true : openIds.has(s.id);
                return (
                  <section key={s.id} className={`emp-acc ${open ? 'is-open' : ''}`}>
                    <h2 className="emp-acc__heading">
                      <button
                        type="button"
                        className="emp-acc__btn"
                        aria-expanded={open}
                        onClick={() => toggle(s.id)}
                      >
                        <span className="emp-acc__title">{s.title}</span>
                        <span className="emp-acc__icon">
                          <ChevronDownIcon size={18} />
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div className="emp-acc__body">
                        <MarkdownView markdown={s.body} highlight={query} />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
