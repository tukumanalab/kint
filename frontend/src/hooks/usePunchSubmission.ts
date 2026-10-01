import { useEffect, useRef, useState } from 'react';
import { postPunch } from '../api/punch';
import { playPunchSuccess, playPunchError } from '../utils/audio';
import { ApiError } from '../types/error';
import type { PunchRequest, PunchResponse } from '../types/punch';

export interface OvertimeRequestState {
  payload: PunchRequest;
  message: string;
}

/** エラーコードをユーザー向けメッセージに変換する（打刻共通） */
export function apiErrorMessage(err: ApiError): string {
  if (err.status === 404) {
    return 'カードまたはユーザーが登録されていません。管理者にお問い合わせください。';
  }
  if (err.status === 409) {
    if (err.body.code === 'PUNCH_COOLDOWN_ACTIVE') {
      return err.body.message;
    }
    return '既に打刻済みです。';
  }
  if (err.status === 422) {
    return '入力内容に不備があります。理由を入力してください。';
  }
  return err.body.message ?? '打刻に失敗しました。もう一度お試しください。';
}

export interface UsePunchSubmissionOptions {
  displaySeconds: number;
  deviceToken?: string | null;
}

export interface UsePunchSubmission {
  punchResult: PunchResponse | null;
  punchError: string | null;
  isPunching: boolean;
  overtimeRequest: OvertimeRequestState | null;
  overtimeReason: string;
  showOvertimeField: boolean;
  setOvertimeReason: (v: string) => void;
  /** 「許可済みの超過勤務」ボタン押下時 */
  openOvertimeReasonField: () => void;
  /** 超過勤務申請なしで打刻を確定する */
  submitNoOvertime: () => Promise<void>;
  /** 超過勤務理由を添えて打刻を確定する */
  submitOvertimeReason: () => Promise<void>;
  /** 超過勤務フローをキャンセルする */
  cancelOvertimeRequest: () => void;
  /**
   * 打刻リクエストを送信する。requires_confirmation の場合は window.confirm で確認し、
   * requires_overtime_reason の場合は overtimeRequest state をセットして 'requires_overtime_reason' を返す。
   */
  submitPunchWithConfirmation: (
    payload: PunchRequest,
  ) => Promise<PunchResponse | 'requires_overtime_reason' | null>;
  /**
   * submitPunchWithConfirmation の結果表示・エラー表示・isPunching 管理までを一括して行う。
   * 戻り値は最終的な打刻結果 (確認キャンセル・超過勤務申請待ちの場合は null)。
   */
  executePunch: (payload: PunchRequest) => Promise<PunchResponse | null>;
  clearPunchResult: () => void;
}

/**
 * 打刻の送信・確認フロー (requires_confirmation / requires_overtime_reason)・
 * 結果表示タイマー・効果音再生を共通化するフック。
 * NFC/フォールバック打刻 (PunchPage) と顔認証打刻 (FacePunchPanel) の両方から利用する。
 */
export function usePunchSubmission({
  displaySeconds,
  deviceToken,
}: UsePunchSubmissionOptions): UsePunchSubmission {
  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  const [overtimeRequest, setOvertimeRequest] = useState<OvertimeRequestState | null>(null);
  const [overtimeReason, setOvertimeReason] = useState('');
  const [showOvertimeField, setShowOvertimeField] = useState(false);

  const resultTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  function resolveDeviceToken(): string | null | undefined {
    if (deviceToken !== undefined) return deviceToken;
    return localStorage.getItem('kint_punch_device_token');
  }

  const clearResultTimer = () => {
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  };
  const clearErrorTimer = () => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearResultTimer();
      clearErrorTimer();
    };
  }, []);

  function showPunchResultWithTimeout(resp: PunchResponse, seconds: number) {
    if (!resp.action) {
      // actionがnull（連続打刻無視など）の場合は直前の打刻成功結果を維持する
      return;
    }
    clearResultTimer();
    clearErrorTimer();
    setPunchResult(resp);
    setPunchError(null);
    playPunchSuccess(resp.action);
    resultTimerRef.current = window.setTimeout(() => {
      setPunchResult(null);
      resultTimerRef.current = null;
    }, seconds * 1000);
  }

  function showPunchErrorWithTimeout(errMessage: string, seconds: number, isCooldownError = false) {
    clearErrorTimer();
    if (!isCooldownError) {
      clearResultTimer();
      setPunchResult(null);
    }
    setPunchError(errMessage);
    playPunchError();
    errorTimerRef.current = window.setTimeout(() => {
      setPunchError(null);
      errorTimerRef.current = null;
    }, seconds * 1000);
  }

  async function submitPunchWithConfirmation(
    payload: PunchRequest,
  ): Promise<PunchResponse | 'requires_overtime_reason' | null> {
    const response = await postPunch(payload, resolveDeviceToken());
    if (response.status === 'requires_overtime_reason') {
      setOvertimeRequest({ payload, message: response.message });
      setShowOvertimeField(false);
      setOvertimeReason('');
      return 'requires_overtime_reason';
    }

    if (response.status !== 'requires_confirmation') {
      return response;
    }

    const confirmed = window.confirm(response.message);
    if (!confirmed) {
      return null;
    }

    const secondResponse = await postPunch({ ...payload, confirm: true }, resolveDeviceToken());
    if (secondResponse.status === 'requires_overtime_reason') {
      setOvertimeRequest({ payload: { ...payload, confirm: true }, message: secondResponse.message });
      setShowOvertimeField(false);
      setOvertimeReason('');
      return 'requires_overtime_reason';
    }
    return secondResponse;
  }

  async function executePunch(payload: PunchRequest): Promise<PunchResponse | null> {
    setIsPunching(true);
    try {
      const resp = await submitPunchWithConfirmation(payload);
      if (resp && resp !== 'requires_overtime_reason') {
        showPunchResultWithTimeout(resp, displaySeconds);
        return resp;
      }
      return null;
    } catch (err) {
      const isCooldown =
        err instanceof ApiError && err.status === 409 && err.body.code === 'PUNCH_COOLDOWN_ACTIVE';
      let duration = displaySeconds;
      if (isCooldown && err instanceof ApiError && err.body.detail?.remaining_seconds !== undefined) {
        duration = Number(err.body.detail.remaining_seconds);
      }
      if (err instanceof ApiError) {
        showPunchErrorWithTimeout(apiErrorMessage(err), duration, isCooldown);
      } else {
        showPunchErrorWithTimeout('打刻に失敗しました。もう一度お試しください。', duration, isCooldown);
      }
      return null;
    } finally {
      setIsPunching(false);
    }
  }

  function openOvertimeReasonField() {
    setShowOvertimeField(true);
  }

  function cancelOvertimeRequest() {
    setOvertimeRequest(null);
    setShowOvertimeField(false);
    setOvertimeReason('');
  }

  async function submitNoOvertime(): Promise<void> {
    if (!overtimeRequest) return;
    setIsPunching(true);
    try {
      const resp = await postPunch(
        { ...overtimeRequest.payload, confirm_no_overtime: true },
        resolveDeviceToken(),
      );
      showPunchResultWithTimeout(resp, displaySeconds);
      setOvertimeRequest(null);
    } catch (err) {
      if (err instanceof ApiError) {
        showPunchErrorWithTimeout(apiErrorMessage(err), displaySeconds);
      } else {
        showPunchErrorWithTimeout('打刻に失敗しました。もう一度お試しください。', displaySeconds);
      }
    } finally {
      setIsPunching(false);
    }
  }

  async function submitOvertimeReason(): Promise<void> {
    if (!overtimeRequest || !overtimeReason.trim()) return;
    setIsPunching(true);
    try {
      const resp = await postPunch(
        { ...overtimeRequest.payload, overtime_reason: overtimeReason.trim() },
        resolveDeviceToken(),
      );
      showPunchResultWithTimeout(resp, displaySeconds);
      setOvertimeRequest(null);
    } catch (err) {
      if (err instanceof ApiError) {
        showPunchErrorWithTimeout(apiErrorMessage(err), displaySeconds);
      } else {
        showPunchErrorWithTimeout('打刻に失敗しました。もう一度お試しください。', displaySeconds);
      }
    } finally {
      setIsPunching(false);
    }
  }

  function clearPunchResult() {
    clearResultTimer();
    clearErrorTimer();
    setPunchResult(null);
    setPunchError(null);
  }

  return {
    punchResult,
    punchError,
    isPunching,
    overtimeRequest,
    overtimeReason,
    showOvertimeField,
    setOvertimeReason,
    openOvertimeReasonField,
    submitNoOvertime,
    submitOvertimeReason,
    cancelOvertimeRequest,
    submitPunchWithConfirmation,
    executePunch,
    clearPunchResult,
  };
}
