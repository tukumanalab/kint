import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  applyImportSettings,
  exportSettings,
  getSettings,
  patchSettings,
  previewImportSettings,
  exportDatabaseBackup,
  restoreDatabaseBackup,
} from '../../api/settings';
import { ApiError } from '../../types/error';
import type { SettingsExportFile, SettingsImportResult, SystemSettings } from '../../types/settings';
import type { UseAuth } from '../../hooks/useAuth';
import { PunchDeviceManager } from './PunchDeviceManager';
import './SettingsPage.css';

interface Props {
  auth: UseAuth;
  onSiteNameChange: (name: string) => void;
}

function apiErrorMessage(err: ApiError): string {
  return err.body.message || '操作に失敗しました。もう一度お試しください。';
}

// ===== インポート確認ダイアログ =====

interface ImportDialogProps {
  file: SettingsExportFile;
  preview: SettingsImportResult;
  onClose: () => void;
  onApply: () => void;
  applying: boolean;
}

function ImportDialog({ file, preview, onClose, onApply, applying }: ImportDialogProps) {
  return (
    <div className="settings-modal-overlay" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <h2 className="settings-modal__title">設定をインポート</h2>
        {preview.warnings.length > 0 && (
          <div className="settings-modal__warnings">
            {preview.warnings.map((w, i) => (
              <p key={i} className="settings-modal__warning-item">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}
        <dl className="settings-modal__meta">
          {file.exported_at && (
            <>
              <dt>エクスポート日時</dt>
              <dd>{new Date(file.exported_at).toLocaleString('ja-JP')}</dd>
            </>
          )}
          {file.exported_by && (
            <>
              <dt>エクスポート者</dt>
              <dd>{file.exported_by}</dd>
            </>
          )}
        </dl>
        <h3 className="settings-modal__section-title">変更内容のプレビュー</h3>
        {preview.changes.length === 0 ? (
          <p className="settings-modal__no-change">変更はありません</p>
        ) : (
          <ul className="settings-modal__changes">
            {preview.changes.map((c) => (
              <li key={c.key}>
                <span className="settings-modal__change-key">{c.key}</span>:{' '}
                <span className="settings-modal__change-before">
                  {c.before === null ? '(未設定)' : String(c.before)}
                </span>{' '}
                →{' '}
                <span className="settings-modal__change-after">
                  {c.after === null ? '(未設定)' : String(c.after)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {preview.ignored_keys.length > 0 && (
          <p className="settings-modal__ignored">
            変更なし・スキップ: {preview.ignored_keys.join(', ')}
          </p>
        )}
        <div className="settings-modal__actions">
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--secondary"
            onClick={onClose}
            disabled={applying}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--primary"
            onClick={onApply}
            disabled={applying || preview.changes.length === 0}
          >
            {applying ? '適用中...' : '適用する'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== メインページ =====

export function SettingsPage({ auth }: Props) {
  const { token } = auth;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState<SystemSettings | null>(null);

  // フォーム値
  const [cooldown, setCooldown] = useState('');
  const [earlyMinutes, setEarlyMinutes] = useState('');
  const [icalUrl, setIcalUrl] = useState('');
  const [syncTime, setSyncTime] = useState('');
  const [siteName, setSiteName] = useState('');

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<SettingsExportFile | null>(null);
  const [importPreview, setImportPreview] = useState<SettingsImportResult | null>(null);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // データベースのフルバックアップ用 state
  const [dbExporting, setDbExporting] = useState(false);
  const [dbRestoring, setDbRestoring] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbSuccess, setDbSuccess] = useState<string | null>(null);
  const dbFileInputRef = useRef<HTMLInputElement>(null);

  async function handleDbExport() {
    if (!token) return;
    setDbError(null);
    setDbSuccess(null);
    setDbExporting(true);
    try {
      await exportDatabaseBackup(token);
      setDbSuccess('データベースのバックアップをダウンロードしました');
      setTimeout(() => setDbSuccess(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? apiErrorMessage(err) : 'バックアップに失敗しました';
      setDbError(msg);
    } finally {
      setDbExporting(false);
    }
  }

  async function handleDbRestoreFileChange(e: ChangeEvent<HTMLInputElement>) {
    setDbError(null);
    setDbSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (e.target) e.target.value = '';

    const confirmRestore = window.confirm(
      '警告：データベースを復元すると、既存のすべてのデータ（ユーザー、勤怠、カード等）が完全に上書きされ、元に戻せません。本当に復元を実行しますか？'
    );
    if (!confirmRestore) return;

    if (!token) return;
    setDbRestoring(true);
    try {
      await restoreDatabaseBackup(token, file);
      setDbSuccess('データベースを正常に復元しました。');
      // 設定値をリロード
      const s = await getSettings(token);
      setCurrent(s);
      setCooldown(String(s.punch_cooldown_seconds));
      setEarlyMinutes(String(s.shift_checkin_early_minutes));
      setIcalUrl(s.shift_ical_url ?? '');
      setSyncTime(s.shift_sync_time ?? '');
      setSiteName(s.site_name ?? 'Kint');
      onSiteNameChange(s.site_name ?? 'Kint');
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? apiErrorMessage(err) : '復元に失敗しました';
      setDbError(msg);
    } finally {
      setDbRestoring(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    getSettings(token)
      .then((s) => {
        setCurrent(s);
        setCooldown(String(s.punch_cooldown_seconds));
        setEarlyMinutes(String(s.shift_checkin_early_minutes));
        setIcalUrl(s.shift_ical_url ?? '');
        setSyncTime(s.shift_sync_time ?? '');
        setSiteName(s.site_name ?? 'Kint');
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof ApiError ? apiErrorMessage(err) : '設定の読み込みに失敗しました';
        setLoadError(msg);
      });
  }, [token]);

  // ----- バリデーション -----

  function validateForm(): string | null {
    if (siteName.trim() === '') {
      return 'サイト名を入力してください';
    }
    const c = Number(cooldown);
    if (!Number.isInteger(c) || c < 0 || c > 3600) {
      return '連続打刻クールダウンは 0〜3600 の整数で入力してください';
    }
    const e = Number(earlyMinutes);
    if (!Number.isInteger(e) || e < 0 || e > 120) {
      return 'シフト開始前チェックイン許容時間は 0〜120 の整数で入力してください';
    }
    if (icalUrl !== '' && !/^https?:\/\//.test(icalUrl)) {
      return 'iCal URL は http:// または https:// で始まる URL を入力してください';
    }
    if (syncTime !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(syncTime)) {
      return '自動同期時刻は HH:MM 形式（例: 03:00）で入力してください';
    }
    return null;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    const validationError = validateForm();
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    if (!token) return;
    setSaving(true);
    try {
      const updated = await patchSettings(token, {
        punch_cooldown_seconds: Number(cooldown),
        shift_checkin_early_minutes: Number(earlyMinutes),
        shift_ical_url: icalUrl || null,
        shift_sync_time: syncTime || null,
        site_name: siteName.trim(),
      });
      setCurrent(updated);
      onSiteNameChange(updated.site_name);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? apiErrorMessage(err) : '保存に失敗しました';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!token) return;
    setExportError(null);
    setExporting(true);
    try {
      await exportSettings(token);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? apiErrorMessage(err) : 'エクスポートに失敗しました';
      setExportError(msg);
    } finally {
      setExporting(false);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setImportParseError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (e.target) e.target.value = '';

    let parsed: SettingsExportFile;
    try {
      const text = await file.text();
      parsed = JSON.parse(text) as SettingsExportFile;
      if (!parsed.settings || typeof parsed.settings !== 'object') {
        throw new Error('settings フィールドが見つかりません');
      }
    } catch {
      setImportParseError('ファイルの形式が正しくありません（JSON を確認してください）');
      return;
    }

    if (!token) return;
    try {
      const preview = await previewImportSettings(token, parsed);
      setImportFile(parsed);
      setImportPreview(preview);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? apiErrorMessage(err) : 'プレビューの取得に失敗しました';
      setImportParseError(msg);
    }
  }

  async function handleApply() {
    if (!token || !importFile) return;
    setApplying(true);
    try {
      const result = await applyImportSettings(token, importFile);
      if (result.applied) {
        setCurrent(result.applied);
        setCooldown(String(result.applied.punch_cooldown_seconds));
        setEarlyMinutes(String(result.applied.shift_checkin_early_minutes));
        setIcalUrl(result.applied.shift_ical_url ?? '');
        setSyncTime(result.applied.shift_sync_time ?? '');
        setSiteName(result.applied.site_name ?? 'Kint');
        onSiteNameChange(result.applied.site_name ?? 'Kint');
      }
      setImportFile(null);
      setImportPreview(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? apiErrorMessage(err) : 'インポートの適用に失敗しました';
      setSaveError(msg);
      setImportFile(null);
      setImportPreview(null);
    } finally {
      setApplying(false);
    }
  }

  // ----- render -----

  if (loadError) {
    return (
      <div className="settings-page">
        <p className="settings-error">{loadError}</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="settings-page">
        <p className="settings-loading">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">システム設定</h1>

      <form onSubmit={handleSave} noValidate>
        <section className="settings-section">
          <h2 className="settings-section__title">一般設定</h2>
          <div className="settings-field">
            <label htmlFor="siteName" className="settings-field__label">
              サイト名
            </label>
            <input
              id="siteName"
              type="text"
              className="settings-field__input settings-field__input--wide"
              placeholder="Kint"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
            />
            <p className="settings-field__hint">ヘッダーやログイン画面、ブラウザタブのタイトルに使用されます</p>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__title">打刻規則</h2>

          <div className="settings-field">
            <label htmlFor="cooldown" className="settings-field__label">
              連続打刻クールダウン
            </label>
            <div className="settings-field__input-row">
              <input
                id="cooldown"
                type="number"
                className="settings-field__input"
                min={0}
                max={3600}
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
              />
              <span className="settings-field__unit">秒（0〜3600）</span>
            </div>
          </div>

          <div className="settings-field">
            <label htmlFor="earlyMinutes" className="settings-field__label">
              シフト開始前チェックイン許容時間
            </label>
            <div className="settings-field__input-row">
              <input
                id="earlyMinutes"
                type="number"
                className="settings-field__input"
                min={0}
                max={120}
                value={earlyMinutes}
                onChange={(e) => setEarlyMinutes(e.target.value)}
              />
              <span className="settings-field__unit">分（0〜120）</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__title">シフトカレンダー</h2>

          <div className="settings-field">
            <label htmlFor="icalUrl" className="settings-field__label">
              iCal 同期 URL
            </label>
            <input
              id="icalUrl"
              type="url"
              className="settings-field__input settings-field__input--wide"
              placeholder="https://example.com/calendar.ics"
              value={icalUrl}
              onChange={(e) => setIcalUrl(e.target.value)}
            />
            <p className="settings-field__hint">未入力で「未設定」扱い</p>
          </div>

          <div className="settings-field">
            <label htmlFor="syncTime" className="settings-field__label">
              自動同期時刻
            </label>
            <div className="settings-field__input-row">
              <input
                id="syncTime"
                type="text"
                className="settings-field__input"
                placeholder="03:00"
                value={syncTime}
                onChange={(e) => setSyncTime(e.target.value)}
              />
              <span className="settings-field__unit">HH:MM（未入力で自動同期 OFF）</span>
            </div>
            <p className="settings-field__hint">毎日この時刻に iCal からシフトを自動取り込みします</p>
          </div>
        </section>

        {saveError && <p className="settings-error">{saveError}</p>}
        {saveSuccess && <p className="settings-success">設定を保存しました</p>}

        <div className="settings-actions">
          <button
            type="submit"
            className="settings-btn settings-btn--primary"
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>

      <section className="settings-section">
        <h2 className="settings-section__title">設定のインポート／エクスポート</h2>
        {exportError && <p className="settings-error">{exportError}</p>}
        {importParseError && <p className="settings-error">{importParseError}</p>}
        <div className="settings-backup-actions">
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'エクスポート中...' : '↑ 設定をエクスポート'}
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            ↓ 設定をインポート...
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">データベースのフルバックアップ</h2>
        <p className="settings-field__hint" style={{ marginBottom: '1rem' }}>
          勤怠記録、ユーザー情報、NFCカード登録を含むデータベース全体（SQLiteファイル）をバックアップ・復元します。
        </p>
        {dbError && <p className="settings-error">{dbError}</p>}
        {dbSuccess && <p className="settings-success">{dbSuccess}</p>}
        <div className="settings-backup-actions">
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={handleDbExport}
            disabled={dbExporting || dbRestoring}
          >
            {dbExporting ? 'ダウンロード中...' : '↑ データベースをダウンロード'}
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={() => dbFileInputRef.current?.click()}
            disabled={dbExporting || dbRestoring}
          >
            {dbRestoring ? '復元中...' : '↓ データベースを復元...'}
          </button>
          <input
            ref={dbFileInputRef}
            type="file"
            accept=".db,application/x-sqlite3"
            style={{ display: 'none' }}
            onChange={handleDbRestoreFileChange}
          />
        </div>
      </section>

      <PunchDeviceManager auth={auth} />

      {importFile && importPreview && (
        <ImportDialog
          file={importFile}
          preview={importPreview}
          onClose={() => {
            setImportFile(null);
            setImportPreview(null);
          }}
          onApply={handleApply}
          applying={applying}
        />
      )}
    </div>
  );
}
