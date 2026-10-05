import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../../hooks/useCamera';
import { detectSingleDescriptor, preloadFaceModels } from '../../face/faceEngine';
import type { FaceStatus, FaceVerifyResult } from '../../types/face';
import './FaceRegistration.css';

const CAPTURE_PROMPTS = ['正面を向いてください', '少し左を向いてください', '少し右を向いてください', '少し上を向いてください', '少し下を向いてください'];
const REQUIRED_SAMPLES = CAPTURE_PROMPTS.length;

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
      <p className="face-registration__hint">
        一致度の距離: {result.distance.toFixed(3)}（しきい値 シフト時 {result.threshold} / シフト外{' '}
        {result.threshold_no_shift}、小さいほど一致）
      </p>
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

  const [testResult, setTestResult] = useState<FaceVerifyResult | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const busyRef = useRef(false);

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
    setDescriptors([]);
    setCaptureIndex(0);
    setCaptureMessage(null);
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

  /** 「撮影」ボタン押下時に現在のフレームから顔特徴量を 1 件取得する */
  async function handleShutter() {
    if (busyRef.current) return;
    const video = camera.videoRef.current;
    if (!video || video.readyState < 2) {
      setCaptureMessage('カメラの準備中です。少し待ってからもう一度押してください。');
      return;
    }
    busyRef.current = true;
    setShooting(true);
    try {
      const result = await detectSingleDescriptor(video);
      if (!result.ok) {
        setCaptureMessage(detectFailureMessage(result.reason));
        return;
      }
      setCaptureMessage(null);
      const next = [...descriptors, result.descriptor];
      setDescriptors(next);
      if (next.length >= REQUIRED_SAMPLES) {
        camera.stop();
        setPhase('ready_to_submit');
      } else {
        setCaptureIndex(next.length);
      }
    } catch (e) {
      console.warn('[FaceRegistration] capture failed:', e);
      setCaptureMessage('撮影に失敗しました。もう一度お試しください。');
    } finally {
      busyRef.current = false;
      setShooting(false);
    }
  }

  function handleCancelCapture() {
    camera.stop();
    setDescriptors([]);
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
      setSubmitSuccess('顔認証データを登録しました。');
      setDescriptors([]);
      setPhase('idle');
      setConsentChecked(false);
    } catch {
      setSubmitError('登録に失敗しました。もう一度お試しください。');
      setPhase('ready_to_submit');
    }
  }

  function handleRetry() {
    setDescriptors([]);
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

  return (
    <div className="face-registration">
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
          </div>
          <p className="face-registration__prompt">
            {CAPTURE_PROMPTS[Math.min(captureIndex, CAPTURE_PROMPTS.length - 1)]}
          </p>
          <div className="face-registration__progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={REQUIRED_SAMPLES}>
            <div className="face-registration__progress-bar" style={{ width: `${(progress / REQUIRED_SAMPLES) * 100}%` }} />
          </div>
          <p className="face-registration__progress-label">{progress} / {REQUIRED_SAMPLES} 枚 撮影済み</p>
          <p className="face-registration__hint">
            楕円の枠に顔を合わせ、指示の向きにしてから「撮影」ボタンを押してください（全 {REQUIRED_SAMPLES} 枚）。
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
          <div className="face-registration__capture-actions">
            <button
              type="button"
              className="btn btn--primary face-registration__shutter"
              onClick={() => void handleShutter()}
              disabled={shooting || modelState !== 'ready' || camera.status !== 'streaming'}
            >
              {shooting ? '撮影中...' : `📸 撮影 (${progress + 1}/${REQUIRED_SAMPLES})`}
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleCancelCapture}>
              中止
            </button>
          </div>
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
        </div>
      )}

      {phase === 'ready_to_submit' && (
        <div className="face-registration__submit">
          <p className="face-registration__hint">{REQUIRED_SAMPLES} 枚の撮影が完了しました。登録しますか？</p>
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
