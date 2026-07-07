import type { AlertRule, AlertTarget, AlertOperator } from '../../types/settings';
import './AttendanceAlertRulesManager.css';

interface Props {
  rules: AlertRule[];
  onChange: (rules: AlertRule[]) => void;
}

export function AttendanceAlertRulesManager({ rules, onChange }: Props) {
  function handleAdd() {
    onChange([
      ...rules,
      {
        id: crypto.randomUUID(),
        target: 'daily_working_hours',
        operator: '>',
        threshold_value: 0,
        message: '要確認：'
      }
    ]);
  }

  function handleRemove(id: string) {
    onChange(rules.filter(r => r.id !== id));
  }

  function handleChange(id: string, field: keyof AlertRule, value: string | number) {
    onChange(rules.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  const targetOptions: { value: AlertTarget, label: string }[] = [
    { value: 'check_in_time', label: '出勤時刻' },
    { value: 'check_out_time', label: '退勤時刻' },
    { value: 'daily_working_hours', label: '1日の勤務時間(h)' },
    { value: 'weekly_working_days', label: '週の勤務日数(日)' },
    { value: 'weekly_working_hours', label: '週の勤務時間(h)' },
  ];

  const operatorOptions: { value: AlertOperator, label: string }[] = [
    { value: '<', label: '未満 (<)' },
    { value: '<=', label: '以下 (<=)' },
    { value: '>', label: '超過 (>)' },
    { value: '>=', label: '以上 (>=)' },
  ];

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">アラート設定</h2>
      <p className="settings-field__hint" style={{ marginBottom: '1rem' }}>
        勤怠画面に表示される「要確認」のアラート条件を設定します。
      </p>
      
      <div className="alert-rules-list">
        {rules.map(rule => (
          <div key={rule.id} className="alert-rule-item">
            <select
              value={rule.target}
              onChange={(e) => handleChange(rule.id, 'target', e.target.value)}
              className="settings-field__select"
            >
              {targetOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            
            <select
              value={rule.operator}
              onChange={(e) => handleChange(rule.id, 'operator', e.target.value)}
              className="settings-field__select"
            >
              {operatorOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {rule.target.endsWith('_time') ? (
              <input
                type="time"
                value={rule.threshold_value}
                onChange={(e) => handleChange(rule.id, 'threshold_value', e.target.value)}
                className="settings-field__input alert-rule-time-input"
              />
            ) : (
              <input
                type="number"
                step="0.5"
                value={rule.threshold_value}
                onChange={(e) => handleChange(rule.id, 'threshold_value', Number(e.target.value))}
                className="settings-field__input alert-rule-number-input"
              />
            )}

            <input
              type="text"
              value={rule.message}
              onChange={(e) => handleChange(rule.id, 'message', e.target.value)}
              className="settings-field__input alert-rule-message-input"
              placeholder="表示メッセージ"
            />

            <button
              type="button"
              className="alert-rule-remove-btn"
              onClick={() => handleRemove(rule.id)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="settings-btn settings-btn--secondary"
        onClick={handleAdd}
        style={{ marginTop: '1rem' }}
      >
        + ルールを追加
      </button>
    </section>
  );
}
