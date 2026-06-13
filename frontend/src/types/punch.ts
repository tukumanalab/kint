/** WebUSB NFC（card_idm）による打刻リクエスト */
export interface PunchRequestByCard {
  card_idm: string;
  device_id: string;
  occurred_at: string;
  confirm?: boolean;
}

/** user_id（カード忘れ）による打刻リクエスト */
export interface PunchRequestByUserId {
  user_id: string;
  reason: string;
  device_id: string;
  occurred_at: string;
  confirm?: boolean;
}

export type PunchRequest = PunchRequestByCard | PunchRequestByUserId;

export interface PunchResponse {
  status: 'completed' | 'requires_confirmation';
  attendance_id: string | null;
  user_id: string;
  user_name: string;
  action: 'check_in' | 'check_out' | 'cancelled' | null;
  occurred_at: string;
  method: 'card_idm' | 'user_id';
  message: string;
  calculated_time?: string | null;
  current_working_hours?: number | null;
  daily_working_hours_total?: number | null;
}

export interface PunchUserCandidate {
  id: string;
  name: string;
  full_name: string;
}

export interface PunchUserCandidateListResponse {
  users: PunchUserCandidate[];
}
