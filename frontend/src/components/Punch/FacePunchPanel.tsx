import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../../hooks/useCamera';
import { detectSingleDescriptor } from '../../face/faceEngine';
import { identifyFace } from '../../api/face';
import { initAudio } from '../../utils/audio';
import { speak, unlockSpeech, buildGreeting, buildResultSpeech } from '../../utils/speech';
import type { UsePunchSubmission } from '../../hooks/usePunchSubmission';
import type { FacePunchConfig, FaceIdentifyResponse } from '../../types/face';
import { FaceAvatar } from './FaceAvatar';
import type { FaceAvatarState } from './FaceAvatar';
import './FacePunchPanel.css';

const DEVICE_ID = 'web-browser';
const DETECT_INTERVAL_MS = 500;
const UNMATCHED_HINT_THRESHOLD = 6; // 約3秒間 (500ms x 6) 不一致が続いたらヒント表示
const RESULT_DISPLAY_MS = 3000;
const DEFAULT_COOLDOWN_SECONDS = 5;

type PanelState = 'stopped' | 'scanning' | 'recognized' | 'punching' | 'result';

export interface FacePunchPanelProps {
  config: FacePunchConfig;
  punchSubmission: UsePunchSubmission;
}

function deviceToken(): string | null {
  return localStorage.getItem('kint_punch_device_token');
}

export function FacePunchPanel({ config, punchSubmission }: FacePunchPanelProps) {
  const camera = useCamera({ facingMode: 'user' });
  const [panelState, setPanelState] = useState<PanelState>('stopped');
  const [recognized, setRecognized] = useState<FaceIdentifyResponse | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [avatarState, setAvatarState] = useState<FaceAvatarState>('idle');
  const [speechText, setSpeechText] = useState<string>('');
  const [speaking, setSpeaking] = useState(false);
  const speechIdRef = useRef(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  const busyRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const suppressRef = useRef<{ userId: string; until: number } | null>(null);
  const panelStateRef = useRef<PanelState>('stopped');
  panelStateRef.current = panelState;

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    void initAudio();
    unlockSpeech();
    await camera.start();
    setPanelState('scanning');
    setAvatarState('looking');
    setSpeechText('');
  }

  function backToScanning() {
    clearCountdownTimer();
    clearResultTimer();
    setRecognized(null);
    setCountdown(null);
    setPanelState('scanning');
    setAvatarState('looking');
    setSpeechText('');
  }

  function suppressUser(userId: string) {
    suppressRef.current = { userId, until: Date.now() + cooldownSeconds * 1000 };
  }

  // ===== 検出ループ =====
  useEffect(() => {
    if (panelState !== 'scanning' || camera.status !== 'streaming') return;
    const id = window.setInterval(() => {
      void tick();
    }, DETECT_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelState, camera.status]);

  async function tick() {
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
      if (suppress && suppress.userId === resp.user_id && Date.now() < suppress.until) {
        return;
      }
      if (panelStateRef.current !== 'scanning') return;
      setUnmatchedCount(0);
      handleRecognized(resp);
    } catch (e) {
      console.warn('[FacePunch] detection failed:', e);
    } finally {
      busyRef.current = false;
    }
  }

  /** 吹き出しを表示して読み上げる。読み上げ中のみアバターの口を開ける */
  function say(text: string) {
    setSpeechText(text);
    const id = ++speechIdRef.current;
    speak(text, {
      onStart: () => {
        if (speechIdRef.current === id) setSpeaking(true);
      },
      onEnd: () => {
        if (speechIdRef.current === id) setSpeaking(false);
      },
    });
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

  async function doPunch(resp: FaceIdentifyResponse) {
    if (!resp.face_match_token) return;
    clearCountdownTimer();
    setPanelState('punching');
    const result = await punchSubmission.executePunch({
      face_match_token: resp.face_match_token,
      device_id: DEVICE_ID,
      occurred_at: new Date().toISOString(),
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
      setSpeechText('');
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

  const showUnmatchedHint = unmatchedCount >= UNMATCHED_HINT_THRESHOLD && panelState === 'scanning';

  return (
    <section className="face-punch-panel" aria-label="顔認証打刻">
      {panelState === 'stopped' && (
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
      )}

      {panelState !== 'stopped' && (
        <div className="face-punch-panel__stage">
          <FaceAvatar
            state={avatarState}
            speechText={speechText}
            speaking={speaking}
            faceSide={
              <video
                ref={camera.videoRef}
                className="face-punch-panel__preview"
                autoPlay
                muted
                playsInline
                aria-label="カメラプレビュー"
              />
            }
          />


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
                {countdown !== null ? `${countdown} 秒後に打刻します` : ''}
              </p>
              <button type="button" className="btn btn--secondary" onClick={handleCancelCountdown}>
                取消
              </button>
            </div>
          )}

          {panelState === 'recognized' && recognized && recognized.requires_confirmation && (
            <div className="face-punch-panel__actions">
              <button type="button" className="btn btn--primary" onClick={handleConfirmPunch}>
                {recognized.user_name}さんで打刻する
              </button>
              <button type="button" className="btn btn--secondary" onClick={handleConfirmDifferent}>
                違う
              </button>
            </div>
          )}

          {panelState === 'punching' && (
            <p className="face-punch-panel__status">打刻中...</p>
          )}
        </div>
      )}
    </section>
  );
}
