import { useCallback, useEffect, useRef, useState } from 'react';
import { getMonthlyAttendanceDetail, listCorrectionRequests } from '../../api/attendance';
import type {
  AttendanceCorrectionRequest,
  AttendanceMonthlyDetailResponse,
} from '../../types/attendance';

export interface MonthState {
  data: AttendanceMonthlyDetailResponse | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_MONTH: MonthState = { data: null, loading: false, error: null };

export interface EmployeeData {
  /** 指定月の状態を返す（未取得なら空の状態）。 */
  getMonth: (yearMonth: string) => MonthState;
  /** 未取得の月だけ取得する。 */
  ensureMonth: (yearMonth: string) => void;
  /** 指定月を取り直す（表示中のデータは残したまま更新する）。 */
  refreshMonth: (yearMonth: string) => Promise<void>;
  requests: AttendanceCorrectionRequest[];
  requestsLoaded: boolean;
  reloadRequests: () => Promise<void>;
}

/** 従業員本人の月別勤怠と修正申請をまとめて保持するフック。 */
export function useEmployeeData(token: string, userId: string): EmployeeData {
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const [requests, setRequests] = useState<AttendanceCorrectionRequest[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const requestedRef = useRef<Set<string>>(new Set());

  const refreshMonth = useCallback(
    async (yearMonth: string) => {
      requestedRef.current.add(yearMonth);
      setMonths((prev) => ({
        ...prev,
        [yearMonth]: { data: prev[yearMonth]?.data ?? null, loading: true, error: null },
      }));
      try {
        const data = await getMonthlyAttendanceDetail(token, yearMonth, userId);
        setMonths((prev) => ({ ...prev, [yearMonth]: { data, loading: false, error: null } }));
      } catch (err) {
        const message = err instanceof Error ? err.message : '勤怠データを取得できませんでした';
        setMonths((prev) => ({
          ...prev,
          [yearMonth]: { data: prev[yearMonth]?.data ?? null, loading: false, error: message },
        }));
      }
    },
    [token, userId],
  );

  const ensureMonth = useCallback(
    (yearMonth: string) => {
      if (requestedRef.current.has(yearMonth)) return;
      void refreshMonth(yearMonth);
    },
    [refreshMonth],
  );

  const reloadRequests = useCallback(async () => {
    try {
      const res = await listCorrectionRequests(token);
      setRequests(res.items);
    } catch (err) {
      console.error('修正申請の取得に失敗しました:', err);
    } finally {
      setRequestsLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    // 初回の取得。結果は非同期に state へ反映される。
    void Promise.resolve().then(reloadRequests);
  }, [reloadRequests]);

  const getMonth = useCallback(
    (yearMonth: string): MonthState => months[yearMonth] ?? EMPTY_MONTH,
    [months],
  );

  return { getMonth, ensureMonth, refreshMonth, requests, requestsLoaded, reloadRequests };
}
