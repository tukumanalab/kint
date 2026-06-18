import { useEffect, useRef, useState } from 'react';
import { isWebUSBSupported } from '../../utils/browser';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';
import { postPunch, searchPunchUsers } from '../../api/punch';
import { initAudio, playPunchSuccess, playPunchError } from '../../utils/audio';
import { ApiError } from '../../types/error';
import type { PunchRequest, PunchResponse, PunchUserCandidate } from '../../types/punch';
import './PunchPage.css';

const DEVICE_ID = 'web-browser';

type PunchMode = 'nfc' | 'fallback';

interface FallbackFormState {
  userQuery: string;
  selectedUser: PunchUserCandidate | null;
  reason: string;
}

export interface PunchPageProps {
  displaySeconds?: number;
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
function actionLabel(action: 'check_in' | 'check_out' | 'cancelled'): string {
  if (action === 'check_in') return '出勤';
  if (action === 'check_out') return '退勤';
  return '打刻取消';
}

/** エラーコードをユーザー向けメッセージに変換する */
function apiErrorMessage(err: ApiError): string {
  if (err.status === 404) {
    return 'カードまたはユーザーが登録されていません。管理者にお問い合わせください。';
  }
  if (err.status === 409) {
    if (err.body.code === 'PUNCH_COOLDOWN_ACTIVE') {
      return err.body.message;
    }
    return '既に打刻済みです。';
  }
  if (err.status === 422) {
    return '入力内容に不備があります。理由を入力してください。';
  }
  return err.body.message ?? '打刻に失敗しました。もう一度お試しください。';
}

export function PunchPage({ displaySeconds = 30 }: PunchPageProps) {
  const webUSBSupported = isWebUSBSupported();
  const [mode, setMode] = useState<PunchMode>(webUSBSupported ? 'nfc' : 'fallback');
  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  const [fallback, setFallback] = useState<FallbackFormState>({
    userQuery: '',
    selectedUser: null,
    reason: '',
  });
  const [userCandidates, setUserCandidates] = useState<PunchUserCandidate[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  const nfc = useWebUSBFeliCa();
  const pollingRef = useRef(false);
  const searchRequestRef = useRef(0);
  const resultTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const statusInfo = statusLabel(nfc.status);

  const clearResultTimer = () => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  };

  const clearErrorTimer = () => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  };

  const showPunchResultWithTimeout = (resp: PunchResponse, seconds: number) => {
    clearResultTimer();
    clearErrorTimer();
    setPunchResult(resp);
    setPunchError(null);
    if (resp.action) {
      playPunchSuccess(resp.action);
    }
    resultTimerRef.current = window.setTimeout(() => {
      setPunchResult(null);
      resultTimerRef.current = null;
    }, seconds * 1000);
  };

  const showPunchErrorWithTimeout = (errMessage: string, seconds: number, isCooldownError: boolean = false) => {
    clearErrorTimer();
    if (!isCooldownError) {
      clearResultTimer();
      setPunchResult(null);
    }
    setPunchError(errMessage);
    playPunchError();
    errorTimerRef.current = window.setTimeout(() => {
      setPunchError(null);
      errorTimerRef.current = null;
    }, seconds * 1000);
  };

  useEffect(() => {
    return () => {
      clearResultTimer();
      clearErrorTimer();
    };
  }, []);

  async function submitPunchWithConfirmation(payload: PunchRequest): Promise<PunchResponse | null> {
    const response = await postPunch(payload);
    if (response.status !== 'requires_confirmation') {
      return response;
    }

    const confirmed = window.confirm(response.message);
    if (!confirmed) {
      return null;
    }

    return postPunch({ ...payload, confirm: true });
  }

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
          try {
            const resp = await submitPunchWithConfirmation({
              card_idm: idm,
              device_id: DEVICE_ID,
              occurred_at: new Date().toISOString(),
            });
            if (resp) {
              showPunchResultWithTimeout(resp, displaySeconds);
            }
          } catch (err) {
            const isCooldown = err instanceof ApiError && err.status === 409 && err.body.code === 'PUNCH_COOLDOWN_ACTIVE';
            let duration = displaySeconds;
            if (isCooldown && err instanceof ApiError && err.body.detail?.remaining_seconds !== undefined) {
              duration = Number(err.body.detail.remaining_seconds);
            }
            if (err instanceof ApiError) {
              showPunchErrorWithTimeout(apiErrorMessage(err), duration, isCooldown);
            } else {
              showPunchErrorWithTimeout('打刻に失敗しました。もう一度お試しください。', duration, isCooldown);
            }
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
  }, [nfc.status, displaySeconds]);

  useEffect(() => {
    const query = fallback.userQuery.trim();

    if (!query) {
      setUserCandidates([]);
      setUserSearchError(null);
      setIsSearchingUsers(false);
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setIsSearchingUsers(true);
    setUserSearchError(null);

    const timerId = window.setTimeout(() => {
      searchPunchUsers(query)
        .then((response) => {
          if (searchRequestRef.current !== requestId) return;
          setUserCandidates(response.users);
        })
        .catch(() => {
          if (searchRequestRef.current !== requestId) return;
          setUserCandidates([]);
          setUserSearchError('ユーザー候補の検索に失敗しました。');
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) {
            setIsSearchingUsers(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [fallback.userQuery]);

  function handleUserQueryChange(value: string) {
    setFallback((current) => ({
      ...current,
      userQuery: value,
      selectedUser:
        current.selectedUser && formatUserLabel(current.selectedUser) === value
          ? current.selectedUser
          : null,
    }));
  }

  function handleSelectUser(user: PunchUserCandidate) {
    setFallback((current) => ({
      ...current,
      userQuery: formatUserLabel(user),
      selectedUser: user,
    }));
    setUserCandidates([]);
    setUserSearchError(null);
  }

  /** user_id フォールバック打刻 */
  async function handleFallbackPunch(e: React.FormEvent) {
    e.preventDefault();
    void initAudio();
    
    if (!fallback.selectedUser || !fallback.reason.trim()) return;
    setIsPunching(true);
    try {
      const resp = await submitPunchWithConfirmation({
        user_id: fallback.selectedUser.id,
        reason: fallback.reason.trim(),
        device_id: DEVICE_ID,
        occurred_at: new Date().toISOString(),
      });
      if (resp) {
        showPunchResultWithTimeout(resp, displaySeconds);
        setFallback({ userQuery: '', selectedUser: null, reason: '' });
        setUserCandidates([]);
      }
    } catch (err) {
      const isCooldown = err instanceof ApiError && err.status === 409 && err.body.code === 'PUNCH_COOLDOWN_ACTIVE';
      let duration = displaySeconds;
      if (isCooldown && err instanceof ApiError && err.body.detail?.remaining_seconds !== undefined) {
        duration = Number(err.body.detail.remaining_seconds);
      }
      if (err instanceof ApiError) {
        showPunchErrorWithTimeout(apiErrorMessage(err), duration, isCooldown);
      } else {
        showPunchErrorWithTimeout('打刻に失敗しました。もう一度お試しください。', duration, isCooldown);
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
              <button
                className="btn btn--primary"
                onClick={() => {
                  void initAudio();
                  nfc.connect();
                }}
              >
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
              NFC カードをお忘れの場合は、表示名または氏名でユーザーを検索し、理由を入力して打刻できます。
            </p>
          )}
          <form className="fallback-form" onSubmit={handleFallbackPunch}>
            <div className="form-field">
              <label htmlFor="userSearch" className="form-label">
                ユーザー検索 <span className="form-required">*</span>
              </label>
              <input
                id="userSearch"
                type="text"
                className="form-input"
                value={fallback.userQuery}
                onChange={(e) => handleUserQueryChange(e.target.value)}
                placeholder="表示名または氏名を入力"
                required
                autoComplete="off"
                aria-describedby="userSearchHint"
              />
              <p id="userSearchHint" className="form-hint">
                表示名・氏名・ユーザー ID の一部で検索できます。
              </p>
              {fallback.selectedUser && (
                <p className="selected-user" role="status">
                  選択中: {formatUserLabel(fallback.selectedUser)}
                </p>
              )}
              {isSearchingUsers && <p className="form-hint">候補を検索中...</p>}
              {userSearchError && (
                <p className="form-error" role="alert">
                  {userSearchError}
                </p>
              )}
              {!isSearchingUsers && !userSearchError && fallback.userQuery.trim() && !fallback.selectedUser && (
                <div className="user-candidate-list" role="listbox" aria-label="ユーザー候補">
                  {userCandidates.length > 0 ? (
                    userCandidates.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="user-candidate"
                        onClick={() => handleSelectUser(user)}
                      >
                        <span className="user-candidate__name">{user.full_name}</span>
                        <span className="user-candidate__meta">{user.name} / {user.id}</span>
                      </button>
                    ))
                  ) : (
                    <p className="form-hint">候補が見つかりません。</p>
                  )}
                </div>
              )}
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
              disabled={isPunching || !fallback.selectedUser || !fallback.reason.trim()}
            >
              {isPunching ? '打刻中...' : '打刻'}
            </button>
          </form>
        </section>
      )}

      {/* ===== 打刻結果 ===== */}
      {punchResult?.status === 'completed' && punchResult.action && (
        <div className={`punch-result ${punchResult.action === 'cancelled' ? 'punch-result--cancelled' : ''}`} role="status" aria-live="polite">
          <p className="punch-result__action">
            {punchResult.action === 'cancelled' ? '打刻を取り消しました' : `${actionLabel(punchResult.action)}しました`}
          </p>
          <p className="punch-result__name">{punchResult.user_name}</p>
          <p className="punch-result__time">{formatDateTime(punchResult.occurred_at)}</p>
          <p className="punch-result__message">{punchResult.message}</p>
          
          {punchResult.action === 'check_in' && punchResult.calculated_time && (
            <div className="punch-result__extra">
              <span className="punch-result__extra-label">勤務出勤時刻 (丸め後): </span>
              <strong className="punch-result__extra-value">{formatTimeOnly(punchResult.calculated_time)}</strong>
            </div>
          )}
          {punchResult.action === 'check_out' && (
            <div className="punch-result__extra">
              {punchResult.current_working_hours !== undefined && punchResult.current_working_hours !== null && (
                <div className="punch-result__extra-row">
                  <span className="punch-result__extra-label">今回の勤務時間: </span>
                  <strong className="punch-result__extra-value">{punchResult.current_working_hours.toFixed(2)} 時間</strong>
                </div>
              )}
              {punchResult.daily_working_hours_total !== undefined && punchResult.daily_working_hours_total !== null && (
                <div className="punch-result__extra-row" style={{ marginTop: '4px' }}>
                  <span className="punch-result__extra-label">本日の合計勤務時間: </span>
                  <strong className="punch-result__extra-value">{punchResult.daily_working_hours_total.toFixed(2)} 時間</strong>
                </div>
              )}
            </div>
          )}
          {punchResult.has_unread_notifications && (
            <div className="punch-result__notification-alert" style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fffaf0', border: '1px solid #feebc8', borderRadius: '6px', color: '#dd6b20', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: '18px', height: '18px', flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span>あなた宛ての未読のお知らせがあります。ログインして確認してください。</span>
            </div>
          )}
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

function formatUserLabel(user: PunchUserCandidate): string {
  return `${user.full_name} (${user.name} / ${user.id})`;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimeOnly(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
