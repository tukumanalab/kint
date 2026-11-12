import { addMonths, formatYearMonth } from './empUtils';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface Props {
  yearMonth: string;
  currentYearMonth: string;
  onChange: (yearMonth: string) => void;
}

/** 「‹ 2026年11月 ›」形式の月切り替え。月入力欄をタップして直接選ぶこともできる。 */
export function MonthSwitcher({ yearMonth, currentYearMonth, onChange }: Props) {
  return (
    <div className="emp-month">
      <button
        type="button"
        className="emp-icon-btn emp-icon-btn--outline"
        aria-label="前の月"
        onClick={() => onChange(addMonths(yearMonth, -1))}
      >
        <ChevronLeftIcon size={20} />
      </button>
      <label className="emp-month__label">
        <span className="emp-month__text">{formatYearMonth(yearMonth)}</span>
        <input
          type="month"
          className="emp-month__input"
          aria-label="表示する月"
          value={yearMonth}
          onChange={(e) => {
            if (/^\d{4}-\d{2}$/.test(e.target.value)) onChange(e.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="emp-icon-btn emp-icon-btn--outline"
        aria-label="次の月"
        onClick={() => onChange(addMonths(yearMonth, 1))}
      >
        <ChevronRightIcon size={20} />
      </button>
      {yearMonth !== currentYearMonth && (
        <button type="button" className="emp-chip" onClick={() => onChange(currentYearMonth)}>
          今月
        </button>
      )}
    </div>
  );
}
