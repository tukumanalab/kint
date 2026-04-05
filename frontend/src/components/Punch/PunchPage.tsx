import { useEffect, useRef, useState } from 'react';
import { isWebUSBSupported } from '../../utils/browser';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';
import { postPunch } from '../../api/punch';
import { ApiError } from '../../types/error';
import type { PunchResponse } from '../../types/punch';
import './PunchPage.css';

const DEVICE_ID = 'web-browser';

type PunchMode = 'nfc' | 'fallback';

interface FallbackFormState {
  userId: string;
  reason: string;
}

/** 接続状態を日本語ラベルと色クラスにマップする */
function statusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case 'idle':
      return { label: '未接続', className: 'status-idle' };
    case 'connecting':
      return { label: '接続中...', className: 'status-connecting' };
    case 'connected':
      return { label: '接続済み', className: 'status-connected' };
    case 'reading':
      return { label: 'カード読み取り中...', className: 'status-reading' };
    case 'success':
      return { label: '読み取り成功', className: 'status-success' };
    case 'error':
      return { label: 'エラー', className: 'status-error' };
    default:
      return { label: status, className: '' };
  }
}

/** 打刻アクションを日本語に変換する */
function actionLabel(action: 'check_in' | 'check_out'): string {
  return action === 'check_in' ? '出勤' : '退勤';
}

/** エラーコードをユーザー向けメッセージに変換する */
function apiErrorMessage(err: ApiError): string {
  if (err.status === 404) {
    return 'カードまたはユーザーが登録されていません。管理者にお問い合わせください。';
  }
  if (err.status === 409) {
    return '既に打刻済みです（二重打刻または不正な状態）。';
  }
  if (err.status === 422) {
    return '入力内容に不備があります。理由を入力してください。';
  }
  return err.body.message ?? '打刻に失敗しました。もう一度お試しください。';
}

export function PunchPage() {
  const webUSBSupported = isWebUSBSupported();
  const [mode, setMode] = useState<PunchMode>(webUSBSupported ? 'nfc' : 'fallback');
  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  const [fallback, setFallback] = useState<FallbackFormState>({ userId: '', reason: '' });

  const nfc = useWebUSBFeliCa();
  const pollingRef = useRef(false);

  const statusInfo = statusLabel(nfc.status);

  // 接続済みになったら自動でカード読み取り → 打刻 → リセット を繰り返す
  useEffect(() => {
    if (mode !== 'nfc' || !webUSBSupported) return;
    if (nfc.status !== 'connected') return;
    if (pollingRef.current) return;

    pollingRef.current = true;

    void (async () => {
      try {
        const idm = await nfc.readIdm();
        if (idm) {
          console.log('[Punch] IDm:', idm);
          setIsPunching(true);
          setPunchError(null);
          try {
            const resp = await postPunch({
              card_idm: idm,
              device_id: DEVICE_ID,
              occurred_at: new Date().toISOString(),
            });
            setPunchResult(resp);
            await new Promise((r) => setTimeout(r, 3000));
            setPunchResult(null);
          } catch (err) {
            if (err instanceof ApiError) {
              setPunchError(apiErrorMessage(err));
            } else {
              setPunchError('打刻に失敗しました。もう一度お試しください。');
            }
            await new Promise((r) => setTimeout(r, 2000));
            setPunchError(null);
          } finally {
            setIsPunching(false);
          }
        }
      } finally {
        pollingRef.current = false;
        nfc.reset(); // status を 'connected' に戻して次のポーリングを開始
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfc.status]);

  /** user_id フォールバック打刻 */
  async function handleFallbackPunch(e: React.FormEvent) {
    e.preventDefault();
    setPunchResult(null);
    setPunchError(null);
    if (!fallback.userId.trim() || !fallback.reason.trim()) return;
    setIsPunching(true);
    try {
      const resp = await postPunch({
        user_id: fallback.userId.trim(),
        reason: fallback.reason.trim(),
        device_id: DEVICE_ID,
        occurred_at: new Date().toISOString(),
      });
      setPunchResult(resp);
      setFallback({ userId: '', reason: '' });
    } catch (err) {
      if (err instanceof ApiError) {
        setPunchError(apiErrorMessage(err));
      } else {
        setPunchError('打刻に失敗しました。もう一度お試しください。');
      }
    } finally {
      setIsPunching(false);
    }
  }

  return (
    <main className="punch-page">
      <h1 className="punch-title">打刻</h1>

      {/* サポート外ブラウザ表示 */}
      {!webUSBSupported && (
        <div className="browser-unsupported" role="alert">
          <p className="browser-unsupported__message">
            このブラウザは WebUSB に対応していないため、NFC カードでの打刻はご利用いただけません。
          </p>
          <p className="browser-unsupported__hint">
            対応ブラウザ: <strong>Windows 11/10 + Chrome または Edge（最新安定版）</strong>
          </p>
        </div>
      )}

      {/* モード切り替えタブ */}
      {webUSBSupported && (
        <div className="punch-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'nfc'}
            className={`punch-tab ${mode === 'nfc' ? 'punch-tab--active' : ''}`}
            onClick={() => setMode('nfc')}
          >
            NFC カード打刻
          </button>
          <button
            role="tab"
            aria-selected={mode === 'fallback'}
            className={`punch-tab ${mode === 'fallback' ? 'punch-tab--active' : ''}`}
            onClick={() => setMode('fallback')}
          >
            カード忘れ打刻
          </button>
        </div>
      )}

      {/* ===== NFC モード ===== */}
      {mode === 'nfc' && webUSBSupported && (
        <section className="punch-section" aria-label="NFC カード打刻">
          {/* 接続状態インジケータ */}
          <div className="nfc-status">
            <span className={`nfc-status__dot ${statusInfo.className}`} aria-hidden="true" />
            <span className="nfc-status__label">{statusInfo.label}</span>
          </div>

          {nfc.errorMessage && (
            <div className="punch-error" role="alert">
              <p>{nfc.errorMessage}</p>
              <p className="punch-error__hint">
                解決しない場合は「カード忘れ打刻」タブに切り替えてください。
              </p>
            </div>
          )}

          <div className="nfc-actions">
            {nfc.status === 'idle' || nfc.status === 'error' ? (
              <button className="btn btn--primary" onClick={nfc.connect}>
                PaSoRi に接続
              </button>
            ) : null}

            {nfc.status !== 'idle' && (
              <button className="btn btn--secondary" onClick={nfc.disconnect}>
                切断
              </button>
            )}
          </div>

          {(nfc.status === 'connected' || nfc.status === 'reading' || nfc.status === 'success') && !isPunching && !punchResult && (
            <p className="nfc-hint">
              カードをかざしてください
            </p>
          )}

          {isPunching && (
            <p className="nfc-hint">打刻中...</p>
          )}
        </section>
      )}

      {/* ===== フォールバックモード ===== */}
      {(mode === 'fallback' || !webUSBSupported) && (
        <section className="punch-section" aria-label="カード忘れ打刻">
          {webUSBSupported && (
            <p className="fallback-description">
              NFC カードをお忘れの場合は、ユーザー ID と理由を入力して打刻できます。
            </p>
          )}
          <form className="fallback-form" onSubmit={handleFallbackPunch}>
            <div className="form-field">
              <label htmlFor="userId" className="form-label">
                ユーザー ID <span className="form-required">*</span>
              </label>
              <input
                id="userId"
                type="text"
                className="form-input"
                value={fallback.userId}
                onChange={(e) => setFallback((f) => ({ ...f, userId: e.target.value }))}
                placeholder="例: user-001"
                required
                autoComplete="off"
              />
            </div>
            <div className="form-field">
              <label htmlFor="reason" className="form-label">
                打刻理由 <span className="form-required">*</span>
              </label>
              <input
                id="reason"
                type="text"
                className="form-input"
                value={fallback.reason}
                onChange={(e) => setFallback((f) => ({ ...f, reason: e.target.value }))}
                placeholder="例: カード忘れのため"
                required
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={isPunching || !fallback.userId.trim() || !fallback.reason.trim()}
            >
              {isPunching ? '打刻中...' : '打刻'}
            </button>
          </form>
        </section>
      )}

      {/* ===== 打刻結果 ===== */}
      {punchResult && (
        <div className="punch-result" role="status" aria-live="polite">
          <p className="punch-result__action">{actionLabel(punchResult.action)}しました</p>
          <p className="punch-result__message">{punchResult.message}</p>
        </div>
      )}

      {/* ===== 打刻エラー ===== */}
      {punchError && (
        <div className="punch-error" role="alert" aria-live="assertive">
          <p>{punchError}</p>
        </div>
      )}
    </main>
  );
}
