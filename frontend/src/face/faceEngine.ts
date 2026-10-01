/**
 * @vladmandic/face-api を用いた顔検出・特徴量抽出エンジン。
 *
 * モデルは `public/face-models/` に同梱しており、外部 CDN には依存しない。
 * モデルロードは遅延・キャッシュされ、初回の検出呼び出し時にのみ行われる。
 */

type FaceApiModule = typeof import('@vladmandic/face-api');

// Vite の base パス（例: /kint/）配下に public ファイルが配信されるため BASE_URL を付与する
const MODEL_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/face-models`;

let modelLoadPromise: Promise<FaceApiModule> | null = null;

/** テスト用にモデルロード状態をリセットする */
export function resetFaceEngineForTesting(): void {
  modelLoadPromise = null;
}

async function loadFaceApi(): Promise<FaceApiModule> {
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((err: unknown) => {
      // 失敗した場合は次回呼び出し時に再試行できるようキャッシュをクリアする
      modelLoadPromise = null;
      throw err;
    });
  }
  return modelLoadPromise;
}

/** 顔認識モデルを事前に読み込む（カメラ起動と並行して呼び出し、初回撮影の待ち時間を減らす） */
export async function preloadFaceModels(): Promise<void> {
  await loadFaceApi();
}

export type DetectFailureReason = 'no_face' | 'multiple_faces' | 'too_small';

export interface DetectSuccessResult {
  ok: true;
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

export interface DetectFailureResult {
  ok: false;
  reason: DetectFailureReason;
}

export type DetectResult = DetectSuccessResult | DetectFailureResult;

const MIN_FACE_SIZE_RATIO = 0.12; // 映像幅に対する最小顔幅比率

/**
 * 映像フレームから単一の顔を検出し、128次元の特徴量ディスクリプタを返す。
 * 顔が検出できない・複数検出された・小さすぎる場合はエラー理由を返す。
 */
export async function detectSingleDescriptor(video: HTMLVideoElement): Promise<DetectResult> {
  const faceapi = await loadFaceApi();

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const detections = await faceapi
    .detectAllFaces(video, options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections || detections.length === 0) {
    return { ok: false, reason: 'no_face' };
  }
  if (detections.length > 1) {
    return { ok: false, reason: 'multiple_faces' };
  }

  const detection = detections[0];
  const { x, y, width, height } = detection.detection.box;
  const videoWidth = video.videoWidth || 1;
  if (width / videoWidth < MIN_FACE_SIZE_RATIO) {
    return { ok: false, reason: 'too_small' };
  }

  return {
    ok: true,
    descriptor: Array.from(detection.descriptor),
    box: { x, y, width, height },
    score: detection.detection.score,
  };
}
