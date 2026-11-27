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
/** 同じ人と連続してこの回数一致したら認識を確定する（1フレームだけの偶然の一致を除く） */
export const CONSENSUS_FRAMES = 3;
/** 認識後（カウントダウン・確認待ち）に本人がこの時間写らなければ取り消す */
export const LOST_FACE_CANCEL_MS = 2000;
const CANCEL_NOTICE_MS = 4000;

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
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const busyRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const suppressRef = useRef<{ userId: string; until: number; lastSeen: number } | null>(null);
  const panelStateRef = useRef<PanelState>('stopped');
  // 認識確定前の候補（同じ人と何回連続で一致したか）
  const candidateRef = useRef<{ userId: string; count: number } | null>(null);
  // 認識後の再照合で更新する最新の照合結果（打刻トークンを新しいものに差し替える）
  const recognizedRef = useRef<FaceIdentifyResponse | null>(null);
  const recognizedLastSeenRef = useRef(0);
  const cancelNoticeTimerRef = useRef<number | null>(null);
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
      if (cancelNoticeTimerRef.current !== null) window.clearTimeout(cancelNoticeTimerRef.current);
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
    candidateRef.current = null;
    recognizedRef.current = null;
    setRecognized(null);
    setCountdown(null);
    setPanelState('scanning');
    setAvatarState('looking');
    clearSpeech();
  }

  /** 認識した本人が写らなくなった・別の人が写った・NFC 打刻が始まったときに認識を取り消す */
  function cancelRecognition(notice: string) {
    backToScanning();
    setCancelNotice(notice);
    if (cancelNoticeTimerRef.current !== null) window.clearTimeout(cancelNoticeTimerRef.current);
    cancelNoticeTimerRef.current = window.setTimeout(() => setCancelNotice(null), CANCEL_NOTICE_MS);
  }

  function suppressUser(userId: string) {
    const now = Date.now();
    suppressRef.current = { userId, until: now + cooldownSeconds * 1000, lastSeen: now };
  }

  // 認識中（カウントダウン・確認待ち）に NFC カードの打刻が始まったら、端末の前に別の人が
  // いるとみなして顔認証の打刻を取り消す（自分の doPunch 中は panelState が punching）
  useEffect(() => {
    if (punchSubmission.isPunching && panelStateRef.current === 'recognized') {
      cancelRecognition('カードの打刻があったため、顔認証の打刻を取り消しました');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punchSubmission.isPunching]);

  // ===== 検出ループ =====
  // 認識後も照合を続け、本人が写り続けていることを確かめる
  useEffect(() => {
    if (paused || camera.status !== 'streaming') return;
    if (panelState !== 'scanning' && panelState !== 'recognized') return;
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
      const resp = result.ok
        ? await identifyFace({ descriptor: result.descriptor }, deviceToken())
        : null;
      const matchedUserId = resp && resp.matched && resp.user_id ? resp.user_id : null;

      if (panelStateRef.current === 'recognized') {
        verifyRecognizedStillPresent(resp, matchedUserId);
        return;
      }
      if (panelStateRef.current !== 'scanning') return;

      if (!resp || !matchedUserId) {
        candidateRef.current = null;
        setUnmatchedCount((c) => c + 1);
        return;
      }
      const suppress = suppressRef.current;
      if (suppress && suppress.userId === matchedUserId) {
        const now = Date.now();
        // 写り続けている間は抑止を延長するため、検出のたびに lastSeen を更新する
        const suppressed = now < suppress.until || now - suppress.lastSeen < ABSENCE_RESET_MS;
        suppress.lastSeen = now;
        if (suppressed) {
          candidateRef.current = null;
          return;
        }
      }
      if (resp.punch_kind === 'ignored') {
        // 出勤直後 (5分以内) は何もしない。その人を抑止してスキャンを続ける
        candidateRef.current = null;
        suppressUser(matchedUserId);
        return;
      }
      setUnmatchedCount(0);
      // 同じ人と CONSENSUS_FRAMES 回連続で一致して初めて認識を確定する
      const candidate = candidateRef.current;
      const count = candidate && candidate.userId === matchedUserId ? candidate.count + 1 : 1;
      candidateRef.current = { userId: matchedUserId, count };
      if (count < CONSENSUS_FRAMES) return;
      candidateRef.current = null;
      handleRecognized(resp);
    } catch (e) {
      console.warn('[FacePunch] detection failed:', e);
    } finally {
      busyRef.current = false;
    }
  }

  /** 認識後の再照合。別の人が写った、または本人がしばらく写らなければ取り消す */
  function verifyRecognizedStillPresent(
    resp: FaceIdentifyResponse | null,
    matchedUserId: string | null,
  ) {
    const current = recognizedRef.current;
    if (!current) return;
    const now = Date.now();
    if (matchedUserId === current.user_id && resp) {
      recognizedLastSeenRef.current = now;
      // 打刻トークン (60秒) を最新の照合結果のものに差し替える
      if (resp.face_match_token) {
        recognizedRef.current = {
          ...current,
          face_match_token: resp.face_match_token,
        };
      }
      return;
    }
    if (matchedUserId !== null) {
      cancelRecognition('別の方が写ったため、打刻を取り消しました');
      return;
    }
    if (now - recognizedLastSeenRef.current > LOST_FACE_CANCEL_MS) {
      cancelRecognition('認識した方が見えなくなったため、打刻を取り消しました');
    }
  }

  function handleRecognized(resp: FaceIdentifyResponse) {
    recognizedRef.current = resp;
    recognizedLastSeenRef.current = Date.now();
    setCancelNotice(null);
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
          void doPunch(recognizedRef.current ?? resp);
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
    // NFC 打刻検知の effect が自分の打刻を取消と誤解しないよう、ref も即座に更新する
    panelStateRef.current = 'punching';
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
    const latest = recognizedRef.current ?? recognized;
    if (latest) {
      void doPunch(latest);
    }
  }

  function handleForceCheckIn() {
    const latest = recognizedRef.current ?? recognized;
    if (latest) {
      void doPunch(latest, { forceCheckIn: true });
    }
  }

  const isCheckOutUpdate = recognized?.punch_kind === 'check_out_update';
  const isCheckOut = recognized?.punch_kind === 'check_out';
  const confirmLabel = isCheckOutUpdate ? '退勤時刻を更新' : isCheckOut ? '退勤する' : '打刻する';

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

          {cancelNotice && panelState === 'scanning' && (
            <p className="face-punch-panel__hint face-punch-panel__hint--warn" role="status">
              {cancelNotice}
            </p>
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
                {recognized.user_name}さんで{confirmLabel}
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
