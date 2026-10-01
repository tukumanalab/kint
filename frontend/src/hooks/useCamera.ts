import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'error';

export interface UseCameraOptions {
  facingMode?: 'user' | 'environment';
}

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

function mapCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'カメラの利用が許可されていません。ブラウザの設定でカメラへのアクセスを許可してください。';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'カメラが見つかりません。デバイスにカメラが接続されているか確認してください。';
    }
  }
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
    return 'このブラウザはカメラ機能（getUserMedia）に対応していません。';
  }
  return 'カメラの起動に失敗しました。もう一度お試しください。';
}

/** getUserMedia によるカメラ映像の開始・停止を管理するフック */
export function useCamera(options: UseCameraOptions = {}): UseCameraReturn {
  const { facingMode = 'user' } = options;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorMessage(mapCameraError(null));
      return;
    }
    setStatus('starting');
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus('streaming');
    } catch (err) {
      setStatus('error');
      setErrorMessage(mapCameraError(err));
    }
  }, [facingMode]);

  // <video> が start() 後に遅れてマウントされる場合（条件付き描画）でも、
  // 描画のたびにストリームを接続し直して真っ黒なプレビューを防ぐ
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (status !== 'streaming' || !video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  });

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, status, errorMessage, start, stop };
}
