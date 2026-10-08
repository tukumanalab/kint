import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../../hooks/useCamera';
import { detectSingleDescriptor, preloadFaceModels } from '../../face/faceEngine';
import type { FaceStatus, FaceVerifyResult } from '../../types/face';
import './FaceRegistration.css';

const CAPTURE_PROMPTS = ['正面を向いてください', '少し左を向いてください', '少し右を向いてください', '少し上を向いてください', '少し下を向いてください'];
const REQUIRED_SAMPLES = CAPTURE_PROMPTS.length;
/** 自動撮影: 最初のポーズまでの待ち秒数（2枚目以降は NEXT） */
const FIRST_POSE_WAIT_SEC = 4;
const NEXT_POSE_WAIT_SEC = 4;
/** 検出スコアがこれ未満の撮影は「やや不鮮明」として目印を付ける */
const LOW_QUALITY_SCORE = 0.7;
/** 撮影確認用サムネイル（端末内でのみ表示し、サーバーには送らない） */
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 72;

interface CapturedShot {
  /** data URL。canvas 非対応環境では null */
  thumbnail: string | null;
  score: number;
}

/** 映像フレームを鏡像で縮小しサムネイル化する（失敗時は null） */
function captureThumbnail(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const vw = video.videoWidth || THUMB_WIDTH;
    const vh = video.videoHeight || THUMB_HEIGHT;
    // 4:3 に中央トリミング
    const srcW = Math.min(vw, (vh * 4) / 3);
    const srcH = Math.min(vh, (vw * 3) / 4);
    ctx.translate(THUMB_WIDTH, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (vw - srcW) / 2, (vh - srcH) / 2, srcW, srcH, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
/** 顔が検出できなかった場合の再試行間隔 */
const DETECT_RETRY_MS = 400;

function detectFailureMessage(reason: 'no_face' | 'multiple_faces' | 'too_small'): string {
  if (reason === 'no_face') return '顔が見つかりません。カメラに顔を映してください。';
  if (reason === 'multiple_faces') return '複数の顔が検出されました。1人だけ映るようにしてください。';
  return '顔が小さすぎます。カメラに近づいてください。';
}

const VERIFY_REASON_TEXT: Record<FaceVerifyResult['reason'], string> = {
  ok: '',
  too_far: '登録データとの差が大きいです。明るい場所で撮り直すか、顔データを再登録してください。',
  other_user_closer: '他の登録者により近いと判定されました。顔データの再登録をおすすめします。',
  ambiguous: '他の登録者と区別しにくい状態です。顔データの再登録をおすすめします。',
};

/**
 * 照合距離をメーターで表示する。距離は小さいほど一致。
 * 0〜シフト外しきい値: 常に認識 / 〜シフト時しきい値: シフト時のみ認識 / それ以上: 認識されない
 */
function FaceDistanceMeter({ result }: { result: FaceVerifyResult }) {
  const { distance, threshold, threshold_no_shift: thresholdNoShift, has_shift: hasShift } = result;
  const low = Math.min(threshold, thresholdNoShift);
  const high = Math.max(threshold, thresholdNoShift);
  const max = Math.max(0.8, Math.ceil((distance + 0.05) * 10) / 10);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const limit = hasShift ? threshold : thresholdNoShift;
  const zone = distance <= low ? 'good' : distance <= high ? 'fair' : 'bad';
  const margin = limit - distance;

  return (
    <div className="face-meter">
      <div className="face-meter__headline">
        <span className="face-meter__label">一致度の距離</span>
        <span className={`face-meter__value face-meter__value--${zone}`}>{distance.toFixed(3)}</span>
        <span className="face-meter__note">小さいほど一致</span>
      </div>

      <div
        className="face-meter__track"
        role="meter"
        aria-label="一致度の距離"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={distance}
      >
        <div className="face-meter__zone face-meter__zone--good" style={{ left: 0, width: pct(low) }} />
        <div
          className="face-meter__zone face-meter__zone--fair"
          style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }}
        />
        <div
          className="face-meter__zone face-meter__zone--bad"
          style={{ left: pct(high), right: 0 }}
        />
        <div className="face-meter__tick" style={{ left: pct(thresholdNoShift) }} />
        <div className="face-meter__tick" style={{ left: pct(threshold) }} />
        <div className="face-meter__marker" style={{ left: pct(distance) }} aria-hidden="true">
          ▼
        </div>
      </div>

      <div className="face-meter__scale" aria-hidden="true">
        <span style={{ left: 0 }}>0</span>
        <span className="face-meter__scale-low" style={{ left: pct(low) }}>
          {low}
        </span>
        <span className="face-meter__scale-high" style={{ left: pct(high) }}>
          {high}
        </span>
        <span style={{ left: '100%' }}>{max}</span>
      </div>

      <ul className="face-meter__legend">
        <li>
          <span className="face-meter__swatch face-meter__swatch--good" />
          {thresholdNoShift} 以下: シフト外でも認識
        </li>
        <li>
          <span className="face-meter__swatch face-meter__swatch--fair" />
          {threshold} 以下: シフト中なら認識
        </li>
        <li>
          <span className="face-meter__swatch face-meter__swatch--bad" />
          それ以上: 認識されない
        </li>
      </ul>

      <p className="face-meter__summary">
        現在は{hasShift ? 'シフト中' : 'シフト外'}のため、しきい値 {limit} で判定しています
        {margin >= 0
          ? `（あと ${margin.toFixed(3)} の余裕）`
          : `（${(-margin).toFixed(3)} 超過）`}
        。
      </p>
    </div>
  );
}

function FaceVerifyResultPanel({ result }: { result: FaceVerifyResult }) {
  const recognized = result.result !== 'not_recognized';
  return (
    <div
      className={`face-registration__test-result face-registration__test-result--${recognized ? 'ok' : 'ng'}`}
      role="status"
    >
      {result.result === 'recognized' && (
        <p className="face-registration__test-result-title">✅ 本人として認識されます（自動打刻）</p>
      )}
      {result.result === 'recognized_with_confirmation' && (
        <p className="face-registration__test-result-title">
          ✅ 本人として認識されます（シフト外のため打刻時に確認ボタンが表示されます）
        </p>
      )}
      {result.result === 'not_recognized' && (
        <>
          <p className="face-registration__test-result-title">⚠️ 認識されませんでした</p>
          <p>{VERIFY_REASON_TEXT[result.reason]}</p>
        </>
      )}
      <FaceDistanceMeter result={result} />
    </div>
  );
}

export interface FaceRegistrationProps {
  /** マイページ（自分自身）か管理者代理登録かで文言・カメラ向きを調整する */
  mode: 'self' | 'admin';
  facingMode?: 'user' | 'environment';
  fetchStatus: () => Promise<FaceStatus>;
  saveDescriptors: (descriptors: number[][]) => Promise<FaceStatus>;
  deleteFace: () => Promise<void>;
  /** 顔認証テスト API。指定すると登録済みのとき「顔認証をテスト」ボタンを表示する */
  verifyFace?: (descriptor: number[]) => Promise<FaceVerifyResult>;
  /** 自動撮影の各ポーズ前の待ち秒数（テスト用。未指定時は 3 秒 / 2 秒） */
  poseWaitSeconds?: { first: number; next: number };
}

type Phase = 'idle' | 'capturing' | 'ready_to_submit' | 'submitting' | 'testing';

/**
 * 顔認証データの登録・確認・削除を行う共通コンポーネント。
 * マイページ (自分自身の登録) と管理者による代理登録の両方から利用する。
 */
export function FaceRegistration({
  mode,
  facingMode = 'user',
  fetchStatus,
  saveDescriptors,
  deleteFace,
  verifyFace,
  poseWaitSeconds = { first: FIRST_POSE_WAIT_SEC, next: NEXT_POSE_WAIT_SEC },
}: FaceRegistrationProps) {
  const camera = useCamera({ facingMode });
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [captureIndex, setCaptureIndex] = useState(0);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [shooting, setShooting] = useState(false);
  const [poseCountdown, setPoseCountdown] = useState<number | null>(null);
  const [capturePaused, setCapturePaused] = useState(false);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [lastCaptured, setLastCaptured] = useState<number | null>(null);

  const [testResult, setTestResult] = useState<FaceVerifyResult | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const busyRef = useRef(false);
  const descriptorsRef = useRef<number[][]>([]);

  function resetDescriptors() {
    descriptorsRef.current = [];
    setDescriptors([]);
    setShots([]);
    setLastCaptured(null);
  }

  function loadStatus() {
    setLoadingStatus(true);
    setStatusError(null);
    fetchStatus()
      .then((s) => setStatus(s))
      .catch(() => setStatusError('登録状況の取得に失敗しました。'))
      .finally(() => setLoadingStatus(false));
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      camera.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartCapture() {
    if (!consentChecked) return;
    setSubmitError(null);
    setSubmitSuccess(null);
    resetDescriptors();
    setCaptureIndex(0);
    setCaptureMessage(null);
    setCapturePaused(false);
    setModelState('loading');
    setPhase('capturing');
    // カメラ起動と並行して顔認識モデルを読み込む
    preloadFaceModels()
      .then(() => setModelState('ready'))
      .catch((e: unknown) => {
        console.warn('[FaceRegistration] model load failed:', e);
        setModelState('error');
      });
    await camera.start();
  }

  /** 顔認証テストを開始する（カメラ起動＋モデル準備） */
  async function handleStartTest() {
    setSubmitError(null);
    setSubmitSuccess(null);
    setTestResult(null);
    setTestMessage(null);
    setModelState('loading');
    setPhase('testing');
    preloadFaceModels()
      .then(() => setModelState('ready'))
      .catch((e: unknown) => {
        console.warn('[FaceRegistration] model load failed:', e);
        setModelState('error');
      });
    await camera.start();
  }

  /** 「テストする」押下時に現在のフレームから特徴量を取得し照合結果を表示する */
  async function handleRunTest() {
    if (busyRef.current || !verifyFace) return;
    const video = camera.videoRef.current;
    if (!video || video.readyState < 2) {
      setTestMessage('カメラの準備中です。少し待ってからもう一度押してください。');
      return;
    }
    busyRef.current = true;
    setShooting(true);
    setTestMessage(null);
    try {
      const detected = await detectSingleDescriptor(video);
      if (!detected.ok) {
        setTestResult(null);
        setTestMessage(detectFailureMessage(detected.reason));
        return;
      }
      setTestResult(await verifyFace(detected.descriptor));
    } catch (e) {
      console.warn('[FaceRegistration] verify failed:', e);
      setTestResult(null);
      setTestMessage('テストに失敗しました。もう一度お試しください。');
    } finally {
      busyRef.current = false;
      setShooting(false);
    }
  }

  function handleEndTest() {
    camera.stop();
    setTestResult(null);
    setTestMessage(null);
    setPhase('idle');
  }

  /** 現在のフレームから顔特徴量を 1 件取得する。成功したら次のポーズへ進み true を返す */
  async function captureOnce(): Promise<boolean> {
    if (busyRef.current) return false;
    const video = camera.videoRef.current;
    if (!video || video.readyState < 2) return false;
    busyRef.current = true;
    setShooting(true);
    try {
      // 確認用サムネイルは検出に使うのと同じタイミングのフレームから先に作る
      // （後で作ると 5 枚目はカメラ停止後になり真っ黒になるため）
      const thumbnail = captureThumbnail(video);
      const result = await detectSingleDescriptor(video);
      if (!result.ok) {
        setCaptureMessage(detectFailureMessage(result.reason));
        return false;
      }
      setCaptureMessage(null);
      const next = [...descriptorsRef.current, result.descriptor];
      descriptorsRef.current = next;
      setDescriptors(next);
      setShots((prev) => [...prev, { thumbnail, score: result.score }]);
      setLastCaptured(next.length);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 250);
      if (next.length >= REQUIRED_SAMPLES) {
        camera.stop();
        setPhase('ready_to_submit');
      } else {
        setCaptureIndex(next.length);
      }
      return true;
    } catch (e) {
      console.warn('[FaceRegistration] capture failed:', e);
      setCaptureMessage('撮影に失敗しました。顔を枠に合わせてください。');
      return false;
    } finally {
      busyRef.current = false;
      setShooting(false);
    }
  }

  // 自動撮影: ポーズごとにカウントダウン → 顔が検出できるまで再試行 → 撮影して次のポーズへ
  useEffect(() => {
    if (
      phase !== 'capturing' ||
      modelState !== 'ready' ||
      camera.status !== 'streaming' ||
      capturePaused
    ) {
      setPoseCountdown(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let remaining = captureIndex === 0 ? poseWaitSeconds.first : poseWaitSeconds.next;

    const attempt = async () => {
      if (cancelled) return;
      const ok = await captureOnce();
      if (!cancelled && !ok) timer = window.setTimeout(() => void attempt(), DETECT_RETRY_MS);
    };
    const tick = () => {
      if (cancelled) return;
      if (remaining <= 0) {
        setPoseCountdown(0);
        void attempt();
        return;
      }
      setPoseCountdown(remaining);
      remaining -= 1;
      timer = window.setTimeout(tick, 1000);
    };
    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, modelState, camera.status, captureIndex, capturePaused]);

  function handleCancelCapture() {
    camera.stop();
    resetDescriptors();
    setCaptureIndex(0);
    setCaptureMessage(null);
    setPhase('idle');
  }

  async function handleSubmit() {
    if (descriptors.length === 0) return;
    setPhase('submitting');
    setSubmitError(null);
    try {
      const s = await saveDescriptors(descriptors);
      setStatus(s);
      setSubmitSuccess(
        verifyFace
          ? '顔認証データを登録しました。「顔認証をテスト」で本人として認識されるか確認できます。'
          : '顔認証データを登録しました。',
      );
      resetDescriptors();
      setPhase('idle');
      setConsentChecked(false);
    } catch {
      setSubmitError('登録に失敗しました。もう一度お試しください。');
      setPhase('ready_to_submit');
    }
  }

  function handleRetry() {
    resetDescriptors();
    setCaptureIndex(0);
    setCaptureMessage(null);
    void handleStartCapture();
  }

  async function handleDelete() {
    if (!window.confirm('登録済みの顔認証データを削除しますか？この操作は取り消せません。')) return;
    setDeleting(true);
    setSubmitError(null);
    try {
      await deleteFace();
      loadStatus();
      setSubmitSuccess('顔認証データを削除しました。');
    } catch {
      setSubmitError('削除に失敗しました。もう一度お試しください。');
    } finally {
      setDeleting(false);
    }
  }

  const progress = Math.min(captureIndex, REQUIRED_SAMPLES);
  // 撮影・テスト中はカメラとボタンを画面内に収めるため、上部の説明と登録状況を隠す
  const cameraActive = phase === 'capturing' || phase === 'testing';

  return (
    <div className="face-registration">
      {!cameraActive && (
        <>
          <div className="face-registration__consent-box">
            <p className="face-registration__consent-text">
              <strong>利用目的:</strong> 打刻時の本人確認のみに利用します。写真そのものは保存せず、
              数値化された特徴データのみをサーバーに保存します。登録は
              {mode === 'self' ? 'いつでもご自身で' : '管理者操作で'}削除できます。
            </p>
          </div>

          {loadingStatus ? (
            <p className="face-registration__hint">読み込み中...</p>
          ) : statusError ? (
            <p className="form-error" role="alert">{statusError}</p>
          ) : (
            <div className="face-registration__status" role="status">
              {status?.registered ? (
                <>
                  <p className="face-registration__status-line">
                    登録済み {status.count} 件
                  </p>
                  {status.updated_at && (
                    <p className="face-registration__status-line face-registration__status-line--muted">
                      更新日時: {new Date(status.updated_at).toLocaleString('ja-JP')}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? '削除中...' : '削除する'}
                  </button>
                  {verifyFace && phase === 'idle' && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => void handleStartTest()}
                      disabled={deleting}
                    >
                      顔認証をテスト
                    </button>
                  )}
                </>
              ) : (
                <p className="face-registration__status-line face-registration__status-line--muted">
                  未登録です。
                </p>
              )}
            </div>
          )}
        </>
      )}

      {submitError && <p className="form-error" role="alert">{submitError}</p>}
      {submitSuccess && <p className="form-success" role="status">{submitSuccess}</p>}

      {phase === 'idle' && (
        <div className="face-registration__start">
          <label className="face-registration__consent-label">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            利用目的に同意して{mode === 'self' ? '自分の' : '対象者の'}顔を登録する
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleStartCapture()}
            disabled={!consentChecked}
          >
            カメラを起動して撮影開始
          </button>
          {camera.errorMessage && (
            <p className="form-error" role="alert">{camera.errorMessage}</p>
          )}
        </div>
      )}

      {phase === 'capturing' && (
        <div className="face-registration__capture">
          <div className="face-registration__viewport">
            <video
              ref={camera.videoRef}
              className="face-registration__video"
              autoPlay
              muted
              playsInline
              aria-label="カメラプレビュー"
            />
            <div className="face-registration__guide-oval" aria-hidden="true" />
            <div className="face-registration__overlay-prompt">
              {progress + 1}/{REQUIRED_SAMPLES}:{' '}
              {CAPTURE_PROMPTS[Math.min(captureIndex, CAPTURE_PROMPTS.length - 1)]}
            </div>
            {lastCaptured !== null && poseCountdown !== null && poseCountdown > 0 && (
              <div className="face-registration__overlay-done">✓ {lastCaptured} 枚目 OK</div>
            )}
            {poseCountdown !== null && poseCountdown > 0 && (
              <div className="face-registration__countdown" aria-live="polite">
                {poseCountdown}
              </div>
            )}
            {poseCountdown === 0 && shooting && (
              <div className="face-registration__countdown face-registration__countdown--small">
                撮影中…
              </div>
            )}
            {capturePaused && (
              <div className="face-registration__countdown face-registration__countdown--small">
                一時停止中
              </div>
            )}
            {flash && <div className="face-registration__flash" aria-hidden="true" />}
          </div>
          <div className="face-registration__capture-actions">
            <button
              type="button"
              className="btn btn--primary face-registration__shutter"
              onClick={() => setCapturePaused((p) => !p)}
              disabled={modelState !== 'ready' || camera.status !== 'streaming'}
            >
              {capturePaused ? '▶ 再開' : '⏸ 一時停止'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleCancelCapture}>
              中止
            </button>
          </div>
          <p className="face-registration__prompt">
            {CAPTURE_PROMPTS[Math.min(captureIndex, CAPTURE_PROMPTS.length - 1)]}
          </p>
          <div className="face-registration__progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={REQUIRED_SAMPLES}>
            <div className="face-registration__progress-bar" style={{ width: `${(progress / REQUIRED_SAMPLES) * 100}%` }} />
          </div>
          <p className="face-registration__progress-label">{progress} / {REQUIRED_SAMPLES} 枚 撮影済み</p>
          <p className="face-registration__hint">
            楕円の枠に顔を合わせ、指示の向きにしてください。数字のカウントダウンが終わると自動で撮影します（全 {REQUIRED_SAMPLES} 枚、1 枚ごとに {NEXT_POSE_WAIT_SEC} 秒の準備時間）。間に合わないときは「一時停止」を押してください。
          </p>
          {modelState === 'loading' && (
            <p className="face-registration__hint" role="status">顔認識モデルを準備中です...</p>
          )}
          {modelState === 'error' && (
            <p className="form-error" role="alert">
              顔認識モデルの読み込みに失敗しました。ページを再読み込みしてお試しください。
            </p>
          )}
          {camera.errorMessage && (
            <p className="form-error" role="alert">{camera.errorMessage}</p>
          )}
          {captureMessage && <p className="face-registration__capture-message" role="alert">{captureMessage}</p>}
        </div>
      )}

      {phase === 'testing' && (
        <div className="face-registration__capture">
          <div className="face-registration__viewport">
            <video
              ref={camera.videoRef}
              className="face-registration__video"
              autoPlay
              muted
              playsInline
              aria-label="カメラプレビュー"
            />
            <div className="face-registration__guide-oval" aria-hidden="true" />
          </div>
          <div className="face-registration__capture-actions">
            <button
              type="button"
              className="btn btn--primary face-registration__shutter"
              onClick={() => void handleRunTest()}
              disabled={shooting || modelState !== 'ready' || camera.status !== 'streaming'}
            >
              {shooting ? 'テスト中...' : '🔍 テストする'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleEndTest}>
              終了
            </button>
          </div>
          <p className="face-registration__hint">
            楕円の枠に顔を合わせて「テストする」を押すと、実際の打刻と同じ照合で認識されるか確認できます。
          </p>
          {modelState === 'loading' && (
            <p className="face-registration__hint" role="status">顔認識モデルを準備中です...</p>
          )}
          {modelState === 'error' && (
            <p className="form-error" role="alert">
              顔認識モデルの読み込みに失敗しました。ページを再読み込みしてお試しください。
            </p>
          )}
          {camera.errorMessage && (
            <p className="form-error" role="alert">{camera.errorMessage}</p>
          )}
          {testMessage && <p className="face-registration__capture-message" role="alert">{testMessage}</p>}
          {testResult && <FaceVerifyResultPanel result={testResult} />}
        </div>
      )}

      {phase === 'ready_to_submit' && (
        <div className="face-registration__submit">
          <p className="face-registration__hint">
            {REQUIRED_SAMPLES} 枚の撮影が完了しました。顔が写っているか確認して登録してください。
          </p>
          {shots.length > 0 && (
            <ul className="face-registration__shots" aria-label="撮影した顔">
              {shots.map((shot, i) => (
                <li key={i} className="face-registration__shot">
                  {shot.thumbnail ? (
                    <img src={shot.thumbnail} alt={`${i + 1}枚目`} className="face-registration__shot-img" />
                  ) : (
                    <span className="face-registration__shot-img face-registration__shot-img--empty" />
                  )}
                  <span
                    className={`face-registration__shot-badge face-registration__shot-badge--${
                      shot.score >= LOW_QUALITY_SCORE ? 'good' : 'low'
                    }`}
                  >
                    {shot.score >= LOW_QUALITY_SCORE ? '良好' : 'やや不鮮明'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="face-registration__hint face-registration__hint--small">
            顔の向きがあまり変わっていなくても認識には使えます（正面の顔が最も重要です）。
            撮影画像はこの画面での確認用で、サーバーには送信・保存されません。
            {shots.some((shot) => shot.score < LOW_QUALITY_SCORE) &&
              ' 「やや不鮮明」が多い場合は、明るい場所で撮り直すと認識精度が上がります。'}
          </p>
          <div className="face-registration__submit-actions">
            <button type="button" className="btn btn--primary" onClick={() => void handleSubmit()}>
              登録する
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleRetry}>
              撮り直す
            </button>
          </div>
        </div>
      )}

      {phase === 'submitting' && <p className="face-registration__hint">登録中...</p>}
    </div>
  );
}
