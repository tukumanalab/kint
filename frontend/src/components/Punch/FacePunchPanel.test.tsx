import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FacePunchPanel } from './FacePunchPanel';
import * as faceEngine from '../../face/faceEngine';
import * as faceApi from '../../api/face';
import * as speech from '../../utils/speech';
import { useCamera } from '../../hooks/useCamera';
import type { UsePunchSubmission } from '../../hooks/usePunchSubmission';
import type { PunchResponse } from '../../types/punch';

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
  };
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

      render(<FacePunchPanel config={CONFIG} punchSubmission={makePunchSubmission(executePunch)} />);

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

      render(<FacePunchPanel config={CONFIG} punchSubmission={makePunchSubmission(executePunch)} />);

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

      render(<FacePunchPanel config={CONFIG} punchSubmission={makePunchSubmission(executePunch)} />);

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
});
