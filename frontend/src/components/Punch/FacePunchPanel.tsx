import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCamera } from '../../hooks/useCamera';
import { detectSingleDescriptor } from '../../face/faceEngine';
import { identifyFace } from '../../api/face';
import { initAudio } from '../../utils/audio';
import { unlockSpeech, buildGreeting, buildResultSpeech } from '../../utils/speech';
import type { UsePunchSubmission } from '../../hooks/usePunchSubmission';
import type { UsePunchAvatar } from '../../hooks/usePunchAvatar';
import type { FacePunchConfig, FaceIdentifyResponse } from '../../types/face';
import { FaceAvatar } from './FaceAvatar';
import './FacePunchPanel.css';

const DEVICE_ID = 'web-browser';
const DETECT_INTERVAL_MS = 500;
const UNMATCHED_HINT_THRESHOLD = 6; // 約3秒間 (500ms x 6) 不一致が続いたらヒント表示
const RESULT_DISPLAY_MS = 3000;
const DEFAULT_COOLDOWN_SECONDS = 5;
const ABSENCE_RESET_MS = 5000; // 顔が検出されなくなってからこの時間が経つまでは同じ人を再認識しない

type PanelState = 'stopped' | 'scanning' | 'recognized' | 'punching' | 'result';

export interface FacePunchPanelProps {
  config: FacePunchConfig;
  punchSubmission: UsePunchSubmission;
  /** PunchPage と共有するアバター状態 (NFC 打刻の結果表示にも使う) */
  avatar: UsePunchAvatar;
  /** true の間は検出ループを止め、照合 API を呼ばない (超過勤務確認中など) */
  paused?: boolean;
  /** 打刻結果・エラーなど、操作欄（アバターの右側）の末尾に表示する要素 */
  messages?: ReactNode;
}

function deviceToken(): string | null {
  return localStorage.getItem('kint_punch_device_token');
}

export function FacePunchPanel({
  config,
  punchSubmission,
  avatar,
  paused = false,
  messages,
}: FacePunchPanelProps) {
  const camera = useCamera({ facingMode: 'user' });
  const [panelState, setPanelState] = useState<PanelState>('stopped');
  const [recognized, setRecognized] = useState<FaceIdentifyResponse | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  const busyRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const suppressRef = useRef<{ userId: string; until: number; lastSeen: number } | null>(null);
  const panelStateRef = useRef<PanelState>('stopped');
  panelStateRef.current = panelState;
  // setInterval 内の tick から最新値を参照するための ref
  const isPunchingRef = useRef(false);
  isPunchingRef.current = punchSubmission.isPunching;
  const { avatarState, speechText, speaking, say, setAvatarState, clearSpeech, setBaseState } = avatar;

  const cooldownSeconds = config.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS;

  const clearCountdownTimer = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };
  const clearResultTimer = () => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  };

  // アンマウント時にカメラ・タイマーを停止する
  useEffect(() => {
    return () => {
      clearCountdownTimer();
      clearResultTimer();
      camera.stop();
      setBaseState('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    void initAudio();
    unlockSpeech();
    await camera.start();
    setPanelState('scanning');
    setBaseState('looking');
    setAvatarState('looking');
    clearSpeech();
  }

  function backToScanning() {
    clearCountdownTimer();
    clearResultTimer();
    setRecognized(null);
    setCountdown(null);
    setPanelState('scanning');
    setAvatarState('looking');
    clearSpeech();
  }

  function suppressUser(userId: string) {
    const now = Date.now();
    suppressRef.current = { userId, until: now + cooldownSeconds * 1000, lastSeen: now };
  }

  // ===== 検出ループ =====
  useEffect(() => {
    if (paused || panelState !== 'scanning' || camera.status !== 'streaming') return;
    const id = window.setInterval(() => {
      void tick();
    }, DETECT_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelState, camera.status, paused]);

  async function tick() {
    // NFC など他方式の打刻送信中は照合しない（二重送信防止）
    if (isPunchingRef.current) return;
    if (busyRef.current) return;
    const video = camera.videoRef.current;
    if (!video || video.readyState < 2) return;
    busyRef.current = true;
    try {
      const result = await detectSingleDescriptor(video);
      if (!result.ok) {
        setUnmatchedCount((c) => c + 1);
        return;
      }
      const resp = await identifyFace({ descriptor: result.descriptor }, deviceToken());
      if (!resp.matched || !resp.user_id) {
        setUnmatchedCount((c) => c + 1);
        return;
      }
      const suppress = suppressRef.current;
      if (suppress && suppress.userId === resp.user_id) {
        const now = Date.now();
        // 写り続けている間は抑止を延長するため、検出のたびに lastSeen を更新する
        const suppressed = now < suppress.until || now - suppress.lastSeen < ABSENCE_RESET_MS;
        suppress.lastSeen = now;
        if (suppressed) return;
      }
      if (panelStateRef.current !== 'scanning') return;
      if (resp.punch_kind === 'ignored') {
        // 出勤直後 (5分以内) は何もしない。その人を抑止してスキャンを続ける
        suppressUser(resp.user_id);
        return;
      }
      setUnmatchedCount(0);
      handleRecognized(resp);
    } catch (e) {
      console.warn('[FacePunch] detection failed:', e);
    } finally {
      busyRef.current = false;
    }
  }

  function handleRecognized(resp: FaceIdentifyResponse) {
    setRecognized(resp);
    setPanelState('recognized');
    setAvatarState('greeting');
    const greeting = buildGreeting(resp.greeting_kind ?? 'check_in', resp.user_name ?? '');
    say(greeting);

    if (!resp.requires_confirmation) {
      let remaining = config.countdown_seconds;
      setCountdown(remaining);
      clearCountdownTimer();
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearCountdownTimer();
          setCountdown(0);
          void doPunch(resp);
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    } else {
      setCountdown(null);
    }
  }

  async function doPunch(resp: FaceIdentifyResponse, options?: { forceCheckIn?: boolean }) {
    if (!resp.face_match_token) return;
    clearCountdownTimer();
    setPanelState('punching');
    const result = await punchSubmission.executePunch({
      face_match_token: resp.face_match_token,
      device_id: DEVICE_ID,
      occurred_at: new Date().toISOString(),
      ...(options?.forceCheckIn ? { face_force_check_in: true } : {}),
    });

    if (resp.user_id) {
      suppressUser(resp.user_id);
    }

    if (result?.action) {
      setAvatarState('success');
      const text = buildResultSpeech(result.action);
      say(text);
    } else if (result) {
      // action が null (連続打刻無視など) の場合はエラー扱いせず淡々と戻る
      setAvatarState('idle');
      clearSpeech();
    } else {
      // エラー、確認キャンセル、超過勤務申請待ちのいずれか
      setAvatarState('error');
      say('打刻できませんでした');
    }

    setPanelState('result');
    clearResultTimer();
    resultTimerRef.current = window.setTimeout(() => {
      backToScanning();
    }, RESULT_DISPLAY_MS);
  }

  function handleCancelCountdown() {
    if (recognized?.user_id) {
      suppressUser(recognized.user_id);
    }
    backToScanning();
  }

  function handleConfirmDifferent() {
    if (recognized?.user_id) {
      suppressUser(recognized.user_id);
    }
    backToScanning();
  }

  function handleConfirmPunch() {
    if (recognized) {
      void doPunch(recognized);
    }
  }

  function handleForceCheckIn() {
    if (recognized) {
      void doPunch(recognized, { forceCheckIn: true });
    }
  }

  const isCheckOutUpdate = recognized?.punch_kind === 'check_out_update';

  const showUnmatchedHint = unmatchedCount >= UNMATCHED_HINT_THRESHOLD && panelState === 'scanning';

  const cameraStopped = panelState === 'stopped';

  // カメラ停止中はアバターの横ではなく直下に開始ボタンと説明を出す (横の領域はプレビュー用の小スペースのため)
  const cameraStartBlock = (
    <div className="face-punch-panel__start">
      <p className="face-punch-panel__hint">
        カメラを起動して顔を映すと、自動的に本人を認識して出退勤を打刻します。
      </p>
      <button type="button" className="btn btn--primary" onClick={() => void handleStart()}>
        カメラを開始
      </button>
      {camera.errorMessage && (
        <div className="punch-error" role="alert">
          <p>{camera.errorMessage}</p>
        </div>
      )}
    </div>
  );

  const faceSide = cameraStopped ? undefined : (
    <video
      ref={camera.videoRef}
      className="face-punch-panel__preview"
      autoPlay
      muted
      playsInline
      aria-label="カメラプレビュー"
    />
  );

  return (
    <section className="face-punch-panel" aria-label="顔認証打刻">
      <div className={`face-punch-panel__stage ${cameraStopped ? 'face-punch-panel__stage--stopped' : ''}`}>
        {/* アバターはカメラ停止中も表示する (NFC 打刻の結果案内にも使うため) */}
        <FaceAvatar state={avatarState} speechText={speechText} speaking={speaking} faceSide={faceSide} />

        {/* 開始ボタン・状態表示・操作ボタン（広い画面ではアバターの右側に並べる） */}
        <div className="face-punch-panel__controls">
          {cameraStopped && cameraStartBlock}

          {panelState === 'scanning' && (
            <p className="face-punch-panel__status">顔を認識しています...</p>
          )}

          {showUnmatchedHint && (
            <p className="face-punch-panel__hint face-punch-panel__hint--warn">
              登録されていない方はNFCカードをご利用ください。
            </p>
          )}

          {panelState === 'recognized' && recognized && !recognized.requires_confirmation && (
            <div className="face-punch-panel__actions">
              <p className="face-punch-panel__countdown">
                {countdown !== null
                  ? `${countdown} 秒後に${isCheckOutUpdate ? '退勤時刻を更新します' : '打刻します'}`
                  : ''}
              </p>
              <button type="button" className="btn btn--secondary" onClick={handleCancelCountdown}>
                取消
              </button>
              {isCheckOutUpdate && (
                <button type="button" className="btn btn--primary" onClick={handleForceCheckIn}>
                  出勤として打刻
                </button>
              )}
            </div>
          )}

          {panelState === 'recognized' && recognized && recognized.requires_confirmation && (
            <div className="face-punch-panel__actions">
              <button type="button" className="btn btn--primary" onClick={handleConfirmPunch}>
                {recognized.user_name}さんで{isCheckOutUpdate ? '退勤時刻を更新' : '打刻する'}
              </button>
              {isCheckOutUpdate && (
                <button type="button" className="btn btn--primary" onClick={handleForceCheckIn}>
                  出勤として打刻
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={handleConfirmDifferent}>
                違う
              </button>
            </div>
          )}

          {panelState === 'punching' && (
            <p className="face-punch-panel__status">打刻中...</p>
          )}

          {messages}
        </div>
      </div>
    </section>
  );
}
