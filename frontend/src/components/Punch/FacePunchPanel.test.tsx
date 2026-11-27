import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENSUS_FRAMES, FacePunchPanel, LOST_FACE_CANCEL_MS } from './FacePunchPanel';
import * as faceEngine from '../../face/faceEngine';
import * as faceApi from '../../api/face';
import * as speech from '../../utils/speech';
import { useCamera } from '../../hooks/useCamera';
import type { UsePunchSubmission } from '../../hooks/usePunchSubmission';
import type { PunchResponse } from '../../types/punch';
import type { FaceIdentifyResponse } from '../../types/face';
import { usePunchAvatar } from '../../hooks/usePunchAvatar';

vi.mock('../../hooks/useCamera', () => ({ useCamera: vi.fn() }));
vi.mock('../../utils/audio', () => ({ initAudio: vi.fn().mockResolvedValue(undefined) }));

function patchMountedVideo() {
  const video = document.querySelector('video');
  if (video) {
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
  }
}

function makePunchSubmission(executePunch: UsePunchSubmission['executePunch']): UsePunchSubmission {
  return {
    punchResult: null,
    punchError: null,
    isPunching: false,
    overtimeRequest: null,
    overtimeReason: '',
    showOvertimeField: false,
    setOvertimeReason: vi.fn(),
    openOvertimeReasonField: vi.fn(),
    submitNoOvertime: vi.fn(),
    submitOvertimeReason: vi.fn(),
    cancelOvertimeRequest: vi.fn(),
    submitPunchWithConfirmation: vi.fn(),
    executePunch,
    clearPunchResult: vi.fn(),
    lastOutcomeRef: { current: null },
  };
}

/** usePunchAvatar を実際に使って FacePunchPanel を描画するラッパー */
function PanelHarness({
  punchSubmission,
  paused,
  config = CONFIG,
}: {
  punchSubmission: UsePunchSubmission;
  paused?: boolean;
  config?: { enabled: boolean; countdown_seconds: number; cooldown_seconds: number };
}) {
  const avatar = usePunchAvatar();
  return (
    <FacePunchPanel
      config={config}
      punchSubmission={punchSubmission}
      avatar={avatar}
      paused={paused}
    />
  );
}

const CONFIG = { enabled: true, countdown_seconds: 1, cooldown_seconds: 5 };

describe('FacePunchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCamera).mockReturnValue({
      videoRef: { current: null },
      status: 'streaming',
      errorMessage: null,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    });
    vi.spyOn(speech, 'speak').mockImplementation(() => {});
    vi.spyOn(speech, 'unlockSpeech').mockImplementation(() => {});
  });

  it(
    '認識後カウントダウンを経て face_match_token で打刻される',
    async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: true,
        user_id: 'user-001',
        user_name: '山田 太郎',
        distance: 0.3,
        has_shift: true,
        requires_confirmation: false,
        face_match_token: 'token-abc',
        greeting_kind: 'check_in',
      });
      const executePunch = vi.fn().mockResolvedValue({
        status: 'completed',
        attendance_id: 'att-1',
        user_id: 'user-001',
        user_name: '山田 太郎',
        action: 'check_in',
        occurred_at: '2026-05-15T00:00:00Z',
        method: 'face',
        message: '出勤を記録しました',
      } satisfies PunchResponse);

      render(<PanelHarness punchSubmission={makePunchSubmission(executePunch)} />);

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();

      await waitFor(
        () => {
          expect(screen.getByText(/秒後に打刻します/)).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      await waitFor(
        () => {
          expect(executePunch).toHaveBeenCalledWith(
            expect.objectContaining({ face_match_token: 'token-abc' }),
          );
        },
        { timeout: 5000 },
      );
    },
    15000,
  );

  it(
    'カウントダウン中に取消を押すと打刻されない',
    async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: true,
        user_id: 'user-001',
        user_name: '山田 太郎',
        distance: 0.3,
        has_shift: true,
        requires_confirmation: false,
        face_match_token: 'token-abc',
        greeting_kind: 'check_in',
      });
      const executePunch = vi.fn();

      render(<PanelHarness punchSubmission={makePunchSubmission(executePunch)} />);

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
      fireEvent.click(screen.getByRole('button', { name: '取消' }));

      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(executePunch).not.toHaveBeenCalled();
    },
    15000,
  );

  it(
    'requires_confirmation の場合は確認ボタンが表示される',
    async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: true,
        user_id: 'user-002',
        user_name: '鈴木 花子',
        distance: 0.36,
        has_shift: false,
        requires_confirmation: true,
        face_match_token: 'token-xyz',
        greeting_kind: 'check_in',
      });
      const executePunch = vi.fn().mockResolvedValue(null);

      render(<PanelHarness punchSubmission={makePunchSubmission(executePunch)} />);

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: '鈴木 花子さんで打刻する' })).toBeInTheDocument();
          expect(screen.getByRole('button', { name: '違う' })).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      fireEvent.click(screen.getByRole('button', { name: '鈴木 花子さんで打刻する' }));

      await waitFor(() => {
        expect(executePunch).toHaveBeenCalledWith(
          expect.objectContaining({ face_match_token: 'token-xyz' }),
        );
      });
    },
    15000,
  );

  it(
    'check_out_update では退勤時刻更新の表示になり、出勤として打刻で face_force_check_in が付く',
    async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: true,
        user_id: 'user-001',
        user_name: '山田 太郎',
        distance: 0.3,
        has_shift: true,
        requires_confirmation: false,
        face_match_token: 'token-abc',
        greeting_kind: 'check_out',
        punch_kind: 'check_out_update',
      });
      const executePunch = vi.fn().mockResolvedValue(null);
      render(
        <PanelHarness
          punchSubmission={makePunchSubmission(executePunch)}
          config={{ ...CONFIG, countdown_seconds: 30 }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();

      await waitFor(
        () => {
          expect(screen.getByText(/秒後に退勤時刻を更新します/)).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
      fireEvent.click(screen.getByRole('button', { name: '出勤として打刻' }));
      await waitFor(() => {
        expect(executePunch).toHaveBeenCalledWith(
          expect.objectContaining({ face_match_token: 'token-abc', face_force_check_in: true }),
        );
      });
    },
    15000,
  );

  it(
    'punch_kind が ignored の場合はカウントダウンを出さず打刻もしない',
    async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      const identify = vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: true,
        user_id: 'user-001',
        user_name: '山田 太郎',
        distance: 0.3,
        has_shift: true,
        requires_confirmation: false,
        face_match_token: 'token-abc',
        greeting_kind: 'check_out',
        punch_kind: 'ignored',
      });
      const executePunch = vi.fn();
      render(<PanelHarness punchSubmission={makePunchSubmission(executePunch)} />);

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();
      await waitFor(() => expect(identify).toHaveBeenCalled(), { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(screen.queryByText(/秒後に/)).not.toBeInTheDocument();
      expect(executePunch).not.toHaveBeenCalled();
    },
    15000,
  );

  it('カメラ停止中でもアバターが表示される', () => {
    const { container } = render(
      <PanelHarness punchSubmission={makePunchSubmission(vi.fn())} />,
    );
    expect(container.querySelector('.face-avatar')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'カメラを開始' })).toBeInTheDocument();
  });

  it(
    'paused のときは照合 API が呼ばれない',
    async () => {
      const detect = vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue({
        ok: true,
        descriptor: new Array(128).fill(0.1),
        box: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.9,
      });
      const identify = vi.spyOn(faceApi, 'identifyFace').mockResolvedValue({
        matched: false,
        user_id: null,
        user_name: null,
        distance: null,
        has_shift: false,
        requires_confirmation: false,
        face_match_token: null,
        greeting_kind: null,
      } as never);

      render(
        <PanelHarness punchSubmission={makePunchSubmission(vi.fn())} paused />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(detect).not.toHaveBeenCalled();
      expect(identify).not.toHaveBeenCalled();
    },
    15000,
  );

  describe('誤認識対策', () => {
    const FACE_OK = {
      ok: true as const,
      descriptor: new Array(128).fill(0.1),
      box: { x: 0, y: 0, width: 100, height: 100 },
      score: 0.9,
    };
    const NO_FACE = { ok: false as const, reason: 'no_face' as const };
    const match = (userId: string, name: string, extra: Partial<FaceIdentifyResponse> = {}) =>
      ({
        matched: true,
        user_id: userId,
        user_name: name,
        distance: 0.3,
        has_shift: true,
        requires_confirmation: false,
        face_match_token: `token-${userId}`,
        greeting_kind: 'check_in',
        ...extra,
      }) satisfies FaceIdentifyResponse;
    const NO_MATCH = {
      matched: false,
      user_id: null,
      user_name: null,
      distance: 0.7,
      has_shift: false,
      requires_confirmation: false,
      face_match_token: null,
      greeting_kind: null,
    } satisfies FaceIdentifyResponse;

    async function startCamera() {
      fireEvent.click(screen.getByRole('button', { name: 'カメラを開始' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      patchMountedVideo();
    }

    it('1回だけの一致では認識を確定しない（連続一致が必要）', async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue(FACE_OK);
      const identify = vi
        .spyOn(faceApi, 'identifyFace')
        .mockResolvedValueOnce(match('user-001', '山田 太郎'))
        .mockResolvedValue(NO_MATCH);
      render(<PanelHarness punchSubmission={makePunchSubmission(vi.fn())} />);
      await startCamera();

      await waitFor(
        () => expect(identify.mock.calls.length).toBeGreaterThanOrEqual(CONSENSUS_FRAMES),
        {
          timeout: 5000,
        },
      );
      expect(screen.queryByText(/秒後に/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    }, 15000);

    it('カウントダウン中に本人が写らなくなると打刻を取り消す', async () => {
      const detect = vi.spyOn(faceEngine, 'detectSingleDescriptor');
      for (let i = 0; i < CONSENSUS_FRAMES; i += 1) detect.mockResolvedValueOnce(FACE_OK);
      detect.mockResolvedValue(NO_FACE);
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue(match('user-001', '山田 太郎'));
      const executePunch = vi.fn();
      render(
        <PanelHarness
          punchSubmission={makePunchSubmission(executePunch)}
          config={{ ...CONFIG, countdown_seconds: 30 }}
        />,
      );
      await startCamera();

      await waitFor(() => expect(screen.getByText(/秒後に打刻します/)).toBeInTheDocument(), {
        timeout: 5000,
      });
      await waitFor(
        () =>
          expect(screen.getByText(/見えなくなったため、打刻を取り消しました/)).toBeInTheDocument(),
        { timeout: LOST_FACE_CANCEL_MS + 3000 },
      );
      expect(screen.queryByText(/秒後に/)).not.toBeInTheDocument();
      expect(executePunch).not.toHaveBeenCalled();
    }, 15000);

    it('カウントダウン中に別の人と照合されると打刻を取り消す', async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue(FACE_OK);
      const identify = vi.spyOn(faceApi, 'identifyFace');
      for (let i = 0; i < CONSENSUS_FRAMES; i += 1) {
        identify.mockResolvedValueOnce(match('user-001', '山田 太郎'));
      }
      identify.mockResolvedValue(match('user-002', '鈴木 花子'));
      const executePunch = vi.fn();
      render(
        <PanelHarness
          punchSubmission={makePunchSubmission(executePunch)}
          config={{ ...CONFIG, countdown_seconds: 30 }}
        />,
      );
      await startCamera();

      await waitFor(
        () =>
          expect(screen.getByText(/別の方が写ったため、打刻を取り消しました/)).toBeInTheDocument(),
        { timeout: 6000 },
      );
      expect(executePunch).not.toHaveBeenCalled();
    }, 15000);

    it('認識中に NFC カードの打刻が始まると顔認証の打刻を取り消す', async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue(FACE_OK);
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue(match('user-001', '山田 太郎'));
      const executePunch = vi.fn();
      const submission = makePunchSubmission(executePunch);
      const { rerender } = render(
        <PanelHarness punchSubmission={submission} config={{ ...CONFIG, countdown_seconds: 30 }} />,
      );
      await startCamera();
      await waitFor(() => expect(screen.getByText(/秒後に打刻します/)).toBeInTheDocument(), {
        timeout: 5000,
      });

      rerender(
        <PanelHarness
          punchSubmission={{ ...submission, isPunching: true }}
          config={{ ...CONFIG, countdown_seconds: 30 }}
        />,
      );
      await waitFor(() => expect(screen.getByText(/カードの打刻があったため/)).toBeInTheDocument());
      expect(screen.queryByText(/秒後に/)).not.toBeInTheDocument();
      expect(executePunch).not.toHaveBeenCalled();
    }, 15000);

    it('退勤は確認ボタン「〇〇さんで退勤する」で打刻する', async () => {
      vi.spyOn(faceEngine, 'detectSingleDescriptor').mockResolvedValue(FACE_OK);
      vi.spyOn(faceApi, 'identifyFace').mockResolvedValue(
        match('user-001', '山田 太郎', {
          requires_confirmation: true,
          greeting_kind: 'check_out',
          punch_kind: 'check_out',
        }),
      );
      const executePunch = vi.fn().mockResolvedValue(null);
      render(<PanelHarness punchSubmission={makePunchSubmission(executePunch)} />);
      await startCamera();

      const button = await screen.findByRole(
        'button',
        { name: '山田 太郎さんで退勤する' },
        { timeout: 5000 },
      );
      expect(screen.queryByText(/秒後に/)).not.toBeInTheDocument();
      fireEvent.click(button);
      await waitFor(() =>
        expect(executePunch).toHaveBeenCalledWith(
          expect.objectContaining({ face_match_token: 'token-user-001' }),
        ),
      );
    }, 15000);
  });
});
