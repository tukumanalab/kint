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
    '同意後に自動撮影で5枚撮影して登録する',
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
          poseWaitSeconds={{ first: 0, next: 0 }}
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

      // 自動撮影で 5 枚撮影される（待ち秒数 0 で即撮影）
      await waitFor(() => expect(faceEngine.detectSingleDescriptor).toHaveBeenCalledTimes(5));
      // 登録前に 5 枚の撮影結果と品質の目印を確認できる
      expect(await screen.findByRole('list', { name: '撮影した顔' })).toBeInTheDocument();
      expect(screen.getAllByText('良好')).toHaveLength(5);

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

  describe('顔認証テスト', () => {
    const registered = { registered: true, count: 5, updated_at: '2026-05-15T00:00:00Z' };
    const baseResult = {
      result: 'recognized' as const,
      reason: 'ok' as const,
      distance: 0.123,
      threshold: 0.45,
      threshold_no_shift: 0.38,
      has_shift: true,
    };

    function mockEngine() {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.3),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceEngine, 'preloadFaceModels').mockResolvedValue(undefined);
    }

    async function startTest(verifyFace: ReturnType<typeof vi.fn>) {
      mockEngine();
      render(
        <FaceRegistration
          mode="self"
          fetchStatus={vi.fn().mockResolvedValue(registered)}
          saveDescriptors={vi.fn()}
          deleteFace={vi.fn()}
          verifyFace={verifyFace}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: '顔認証をテスト' }));
      await act(async () => {
        await Promise.resolve();
      });
      patchMountedVideo();
      const run = await screen.findByRole('button', { name: '🔍 テストする' });
      await waitFor(() => expect(run).toBeEnabled());
      return run;
    }

    it('登録済みのときだけテストボタンが表示される', async () => {
      const fetchStatus = vi.fn().mockResolvedValue({ registered: false, count: 0, updated_at: null });
      render(
        <FaceRegistration
          mode="self"
          fetchStatus={fetchStatus}
          saveDescriptors={vi.fn()}
          deleteFace={vi.fn()}
          verifyFace={vi.fn()}
        />,
      );
      await screen.findByText('未登録です。');
      expect(screen.queryByRole('button', { name: '顔認証をテスト' })).not.toBeInTheDocument();
    });

    it('verifyFace 未指定ならテストボタンは表示されない', async () => {
      render(
        <FaceRegistration
          mode="self"
          fetchStatus={vi.fn().mockResolvedValue(registered)}
          saveDescriptors={vi.fn()}
          deleteFace={vi.fn()}
        />,
      );
      await screen.findByText('登録済み 5 件');
      expect(screen.queryByRole('button', { name: '顔認証をテスト' })).not.toBeInTheDocument();
    });

    it('テストするで verifyFace を呼び、認識結果を表示する', async () => {
      const verifyFace = vi.fn().mockResolvedValue(baseResult);
      const run = await startTest(verifyFace);
      fireEvent.click(run);
      expect(await screen.findByText(/本人として認識されます（自動打刻）/)).toBeInTheDocument();
      expect(verifyFace).toHaveBeenCalledWith(new Array(128).fill(0.3));
      expect(screen.getByRole('meter', { name: '一致度の距離' })).toHaveAttribute('aria-valuenow', '0.123');
      expect(screen.getByText('0.123')).toBeInTheDocument();
    });

    it('シフト外では確認ボタンの案内を表示する', async () => {
      const verifyFace = vi
        .fn()
        .mockResolvedValue({ ...baseResult, result: 'recognized_with_confirmation', has_shift: false });
      fireEvent.click(await startTest(verifyFace));
      expect(await screen.findByText(/シフト外のため打刻時に確認ボタンが表示されます/)).toBeInTheDocument();
    });

    it('認識されない場合は理由を表示する', async () => {
      const verifyFace = vi
        .fn()
        .mockResolvedValue({ ...baseResult, result: 'not_recognized', reason: 'too_far' });
      fireEvent.click(await startTest(verifyFace));
      expect(await screen.findByText('⚠️ 認識されませんでした')).toBeInTheDocument();
      expect(screen.getByText(/登録データとの差が大きいです/)).toBeInTheDocument();
    });

    it('API エラー時は失敗メッセージを表示し、終了で idle に戻る', async () => {
      const verifyFace = vi.fn().mockRejectedValue(new Error('x'));
      fireEvent.click(await startTest(verifyFace));
      expect(await screen.findByText('テストに失敗しました。もう一度お試しください。')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '終了' }));
      expect(await screen.findByRole('button', { name: '顔認証をテスト' })).toBeInTheDocument();
    });
  });

  it('顔が検出できない間は理由を表示して自動で再試行する', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ registered: false, count: 0, updated_at: null });
    vi.spyOn(faceEngine, 'preloadFaceModels').mockResolvedValue(undefined);
    const ok = {
      ok: true as const,
      descriptor: new Array(128).fill(0.3),
      box: { x: 0, y: 0, width: 100, height: 100 },
      score: 0.9,
    };
    vi.spyOn(faceEngine, 'detectSingleDescriptor')
      .mockResolvedValueOnce({ ok: false, reason: 'no_face' })
      .mockResolvedValue(ok);

    render(
      <FaceRegistration
        mode="self"
        fetchStatus={fetchStatus}
        saveDescriptors={vi.fn()}
        deleteFace={vi.fn()}
        poseWaitSeconds={{ first: 0, next: 0 }}
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

    expect(await screen.findByText(/顔が見つかりません/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '登録する' }, { timeout: 5000 })).toBeInTheDocument();
    // 失敗 1 回 + 成功 5 回
    expect(faceEngine.detectSingleDescriptor).toHaveBeenCalledTimes(6);
  });
});
