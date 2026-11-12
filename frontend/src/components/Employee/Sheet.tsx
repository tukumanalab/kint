import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 下部に固定表示する操作ボタン群。 */
  footer?: ReactNode;
  /** 画面のほぼ全体を使う（入力フォーム向け）。 */
  tall?: boolean;
}

let openSheetCount = 0;

/** 画面下からせり上がるシート。広い画面では中央のダイアログになる。 */
export function Sheet({ title, subtitle, onClose, children, footer, tall = false }: Props) {
  const titleId = useId();

  // 背面のスクロールを止める（複数のシートが重なっても最後の1枚が閉じるまで維持）
  useEffect(() => {
    openSheetCount += 1;
    document.body.classList.add('emp-scroll-lock');
    return () => {
      openSheetCount -= 1;
      if (openSheetCount === 0) {
        document.body.classList.remove('emp-scroll-lock');
      }
    };
  }, []);

  // ソフトウェアキーボードが出ても、見えている範囲にシート全体（見出し・本文・操作ボタン）が
  // 収まるように、実際に見えている領域（visualViewport）へ背景ごと合わせる
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = backdropRef.current;
    if (!vv || !el) return;
    const update = () => {
      // キーボードが出ていないとき（ブラウザのツールバー分の差しかないとき）は CSS の既定に任せる
      const keyboardOpen = window.innerHeight - vv.height > 120;
      if (!keyboardOpen) {
        el.style.top = '';
        el.style.bottom = '';
        el.style.height = '';
        return;
      }
      el.style.top = `${vv.offsetTop}px`;
      el.style.bottom = 'auto';
      el.style.height = `${vv.height}px`;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && el.contains(focused) && focused.matches('input, textarea')) {
        focused.scrollIntoView({ block: 'nearest' });
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div ref={backdropRef} className="emp-sheet-backdrop" onClick={onClose}>
      <div
        className={`emp-sheet ${tall ? 'emp-sheet--tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="emp-sheet__header">
          <div className="emp-sheet__titles">
            <h2 id={titleId} className="emp-sheet__title">
              {title}
            </h2>
            {subtitle && <div className="emp-sheet__subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="emp-icon-btn" aria-label="閉じる" onClick={onClose}>
            <CloseIcon size={22} />
          </button>
        </div>
        <div className="emp-sheet__body">{children}</div>
        {footer && <div className="emp-sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}
