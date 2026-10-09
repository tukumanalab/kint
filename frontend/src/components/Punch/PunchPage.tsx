import { useEffect, useRef, useState } from 'react';
import { isWebUSBSupported } from '../../utils/browser';
import { useWebUSBFeliCa } from '../../hooks/useWebUSBFeliCa';
import { searchPunchUsers } from '../../api/punch';
import { getFacePunchConfig } from '../../api/face';
import { initAudio } from '../../utils/audio';
import { unlockSpeech, buildGreeting, buildResultSpeech } from '../../utils/speech';
import { usePunchSubmission } from '../../hooks/usePunchSubmission';
import { usePunchAvatar } from '../../hooks/usePunchAvatar';
import type { PunchUserCandidate } from '../../types/punch';
import type { FacePunchConfig } from '../../types/face';
import { FacePunchPanel } from './FacePunchPanel';
import { FaceAvatar } from './FaceAvatar';
import './PunchPage.css';
import { formatHours } from '../../utils/time';

const DEVICE_ID = 'web-browser';

/** main: NFC カード + 顔認証を同時に待ち受ける画面 / fallback: カード忘れ打刻（手入力） */
type PunchMode = 'main' | 'fallback';

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

export function PunchPage({ displaySeconds = 30 }: PunchPageProps) {
  const webUSBSupported = isWebUSBSupported();
  const [mode, setMode] = useState<PunchMode>(webUSBSupported ? 'main' : 'fallback');
  const [fallback, setFallback] = useState<FallbackFormState>({
    userQuery: '',
    selectedUser: null,
    reason: '',
  });
  const [userCandidates, setUserCandidates] = useState<PunchUserCandidate[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [faceConfig, setFaceConfig] = useState<FacePunchConfig | null>(null);

  const nfc = useWebUSBFeliCa();
  const pollingRef = useRef(false);
  const searchRequestRef = useRef(0);
  const lastPunchRef = useRef<{ idm: string; timestamp: number } | null>(null);
  // ユーザーがタブを操作済みか（顔認証設定の取得後に自動でメインタブへ切り替えるかの判定用）
  const tabTouchedRef = useRef(false);

  const punchSubmission = usePunchSubmission({ displaySeconds });
  const avatar = usePunchAvatar();
  const {
    punchResult,
    punchError,
    isPunching,
    overtimeRequest,
    overtimeReason,
    showOvertimeField,
    setOvertimeReason,
    openOvertimeReasonField,
    submitNoOvertime,
    submitOvertimeReason,
    cancelOvertimeRequest,
    executePunch,
    lastOutcomeRef,
  } = punchSubmission;

  const statusInfo = statusLabel(nfc.status);
  const faceEnabled = !!faceConfig?.enabled;
  const mainAvailable = webUSBSupported || faceEnabled;
  const mainTabLabel =
    webUSBSupported && faceEnabled
      ? 'NFC カード / 顔認証'
      : webUSBSupported
        ? 'NFC カード打刻'
        : '顔認証';

  function selectMode(next: PunchMode) {
    tabTouchedRef.current = true;
    setMode(next);
  }

  /** NFC 打刻の結果をアバターの表情・読み上げに反映する */
  function reactToNfcPunch(resp: Awaited<ReturnType<typeof executePunch>>) {
    if (resp) {
      if (resp.action === 'cancelled') {
        avatar.react('success', buildResultSpeech('cancelled'), 3000);
      } else if (resp.action) {
        const text = `${buildGreeting(resp.action, resp.user_name)}。${buildResultSpeech(resp.action)}`;
        avatar.react('success', text, 3000);
      }
      // action が null (連続打刻無視など) の場合は何も喋らない
      return;
    }
    // 超過勤務の確認待ち・確認キャンセルは喋らず、エラーのときだけ案内する
    if (lastOutcomeRef.current === 'error') {
      avatar.react('error', '打刻できませんでした', 3000);
    }
  }

  // 顔認証打刻設定を取得（有効な場合のみタブを表示）
  useEffect(() => {
    const deviceToken = localStorage.getItem('kint_punch_device_token');
    getFacePunchConfig(deviceToken)
      .then((cfg) => setFaceConfig(cfg))
      .catch(() => setFaceConfig(null));
  }, []);

  // WebUSB 非対応端末で顔認証が有効と分かったら、タブ未操作の場合に限りメインタブへ切り替える
  useEffect(() => {
    if (!webUSBSupported && faceEnabled && !tabTouchedRef.current) {
      setMode('main');
    }
  }, [webUSBSupported, faceEnabled]);

  // 接続済みになったら自動でカード読み取り → 打刻 → リセット を繰り返す
  useEffect(() => {
    if (mode !== 'main' || !webUSBSupported) return;
    if (nfc.status !== 'connected') return;
    if (pollingRef.current) return;

    pollingRef.current = true;

    void (async () => {
      try {
        const idm = await nfc.readIdm();
        if (idm) {
          console.log('[Punch] IDm:', idm);

          const now = Date.now();
          if (
            lastPunchRef.current &&
            lastPunchRef.current.idm === idm &&
            now - lastPunchRef.current.timestamp < 3000
          ) {
            console.log('[Punch] Duplicate IDm detected within 3s, skipping API call:', idm);
            return;
          }
          lastPunchRef.current = { idm, timestamp: now };

          const resp = await executePunch({
            card_idm: idm,
            device_id: DEVICE_ID,
            occurred_at: new Date().toISOString(),
          });
          reactToNfcPunch(resp);
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
    const resp = await executePunch({
      user_id: fallback.selectedUser.id,
      reason: fallback.reason.trim(),
      device_id: DEVICE_ID,
      occurred_at: new Date().toISOString(),
    });
    if (resp) {
      setFallback({ userQuery: '', selectedUser: null, reason: '' });
      setUserCandidates([]);
    }
  }

  // 打刻結果・エラー表示。メインタブではアバターの右側（操作欄）に表示する
  const messagesInMain = mode === 'main' && mainAvailable && !overtimeRequest;
  const punchMessages = (
    <>
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
                    <strong className="punch-result__extra-value">{formatHours(punchResult.current_working_hours)}</strong>
                  </div>
                )}
                {punchResult.daily_working_hours_total !== undefined && punchResult.daily_working_hours_total !== null && (
                  <div className="punch-result__extra-row" style={{ marginTop: '4px' }}>
                    <span className="punch-result__extra-label">本日の合計勤務時間: </span>
                    <strong className="punch-result__extra-value">{formatHours(punchResult.daily_working_hours_total)}</strong>
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
    </>
  );

  return (
    <main className="punch-page">
      {/* 画面の小さいノートPCでもアバターの全身が収まるよう、タイトルとタブを 1 行にまとめる */}
      <div className="punch-header">
        <h1 className="punch-title">打刻</h1>

        {/* モード切り替えタブ */}
        {mainAvailable && (
          <div className="punch-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'main'}
              className={`punch-tab ${mode === 'main' ? 'punch-tab--active' : ''}`}
              onClick={() => selectMode('main')}
            >
              {mainTabLabel}
            </button>
            <button
              role="tab"
              aria-selected={mode === 'fallback'}
              className={`punch-tab ${mode === 'fallback' ? 'punch-tab--active' : ''}`}
              onClick={() => selectMode('fallback')}
            >
              カード忘れ打刻
            </button>
          </div>
        )}
      </div>

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

      {/* ===== 超過勤務申請モード ===== */}
      {overtimeRequest && (
        <section className="punch-section" aria-label="超過勤務理由の入力">
          <div className="punch-error" role="alert" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffeeba' }}>
            <p>{overtimeRequest.message}</p>
          </div>

          {!showOvertimeField ? (
            <div className="nfc-actions" style={{ justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  void initAudio();
                  openOvertimeReasonField();
                }}
              >
                許可済みの超過勤務
              </button>
              <button
                className="btn btn--secondary"
                disabled={isPunching}
                onClick={() => {
                  void initAudio();
                  void submitNoOvertime();
                }}
              >
                {isPunching ? '打刻中...' : '超過申請せず打刻'}
              </button>
              <button
                className="btn btn--outline"
                style={{
                  border: '1px solid #cbd5e1',
                  background: 'transparent',
                  color: '#475569',
                  padding: '0.625rem 1.25rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
                disabled={isPunching}
                onClick={cancelOvertimeRequest}
              >
                キャンセル
              </button>
            </div>
          ) : (
            <div className="fallback-form" style={{ marginTop: '1.5rem' }}>
              <div className="form-field">
                <label htmlFor="overtimeReason" className="form-label">
                  超過を承認した管理者と理由 <span className="form-required">*</span>
                </label>
                <input
                  id="overtimeReason"
                  type="text"
                  className="form-input"
                  value={overtimeReason}
                  onChange={(e) => setOvertimeReason(e.target.value)}
                  placeholder="例: 〇〇先生による来客対応の指示"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="nfc-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={isPunching || !overtimeReason.trim()}
                  onClick={() => void submitOvertimeReason()}
                >
                  {isPunching ? '申請中...' : '超過勤務申請'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={cancelOvertimeRequest}
                  disabled={isPunching}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ===== メイン (NFC カード + 顔認証) =====
          超過勤務確認中も顔認証のカメラを止めないよう、アンマウントせず hidden で隠す */}
      {mode === 'main' && mainAvailable && (
        <div hidden={!!overtimeRequest}>
          {webUSBSupported && (
            <section className="punch-section punch-section--nfc" aria-label="NFC カード打刻">
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
                      unlockSpeech();
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

          {faceEnabled && faceConfig ? (
            <FacePunchPanel
              config={faceConfig}
              punchSubmission={punchSubmission}
              avatar={avatar}
              paused={!!overtimeRequest}
              messages={messagesInMain ? punchMessages : null}
            />
          ) : (
            // 顔認証が無効でも顔認証パネルと同じ 2 列レイアウトでアバターの右側にメッセージを表示する
            <div className="face-punch-panel__stage">
              <FaceAvatar
                state={avatar.avatarState}
                speechText={avatar.speechText}
                speaking={avatar.speaking}
              />
              <div className="face-punch-panel__controls">{messagesInMain && punchMessages}</div>
            </div>
          )}
        </div>
      )}

      {/* ===== フォールバックモード ===== */}
      {!overtimeRequest && mode === 'fallback' && (
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
                            <span className="user-candidate__name">
                              {user.full_name} {user.name_kana ? `(${user.name_kana})` : ''}
                            </span>
                            <span className="user-candidate__meta">
                              {user.department ? `${user.department} | ` : ''}
                              {user.worker_id ? `従業員ID: ${user.worker_id} | ` : ''}
                              {user.name} ({user.id})
                            </span>
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


      {/* メインタブ以外（カード忘れ打刻・超過勤務確認中）では従来どおりページ下部に表示 */}
      {!messagesInMain && punchMessages}
    </main>
  );
}

function formatUserLabel(user: PunchUserCandidate): string {
  const meta = [
    user.name_kana ? `カナ: ${user.name_kana}` : null,
    user.department ? `所属: ${user.department}` : null,
    user.worker_id ? `従業員ID: ${user.worker_id}` : null,
    `ID: ${user.id}`,
  ].filter(Boolean).join(' / ');
  return `${user.full_name} (${meta})`;
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
