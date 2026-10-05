import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceRegistration } from './FaceRegistration';
import * as faceEngine from '../../face/faceEngine';
import { useCamera } from '../../hooks/useCamera';

vi.mock('../../hooks/useCamera', () => ({ useCamera: vi.fn() }));

/** React が実際にマウントする <video> 要素に readyState を強制設定する */
function patchMountedVideo() {
  const video = document.querySelector('video');
  if (video) {
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
  }
}

describe('FaceRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCamera).mockReturnValue({
      videoRef: { current: null },
      status: 'streaming',
      errorMessage: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    });
  });

  it('同意チェックなしでは撮影を開始できない', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ registered: false, count: 0, updated_at: null });
    render(
      <FaceRegistration
        mode="self"
        fetchStatus={fetchStatus}
        saveDescriptors={vi.fn()}
        deleteFace={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', { name: 'カメラを起動して撮影開始' }),
    ).toBeDisabled();
  });

  it(
    '同意後に撮影ボタンで5枚撮影して登録する',
    async () => {
      const fetchStatus = vi.fn().mockResolvedValue({ registered: false, count: 0, updated_at: null });
      const saveDescriptors = vi.fn().mockResolvedValue({
        registered: true,
        count: 5,
        updated_at: '2026-05-15T00:00:00Z',
      });
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.2),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceEngine, 'preloadFaceModels').mockResolvedValue(undefined);

      render(
        <FaceRegistration
          mode="self"
          fetchStatus={fetchStatus}
          saveDescriptors={saveDescriptors}
          deleteFace={vi.fn()}
        />,
      );

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'カメラを起動して撮影開始' }));

      await act(async () => {
        await Promise.resolve();
      });
      patchMountedVideo();

      // 「撮影」ボタンを 5 回押して 5 枚撮影する
      for (let i = 1; i <= 5; i++) {
        const shutter = await screen.findByRole('button', { name: `📸 撮影 (${i}/5)` });
        await waitFor(() => expect(shutter).toBeEnabled());
        fireEvent.click(shutter);
        await waitFor(() => expect(faceEngine.detectSingleDescriptor).toHaveBeenCalledTimes(i));
      }

      expect(await screen.findByRole('button', { name: '登録する' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '登録する' }));

      await waitFor(() => {
        expect(saveDescriptors).toHaveBeenCalledWith(
          expect.arrayContaining([expect.arrayContaining([0.2])]),
        );
      });
    },
    15000,
  );
});
