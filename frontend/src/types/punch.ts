/** WebUSB NFC（card_idm）による打刻リクエスト */
export interface PunchRequestByCard {
  card_idm: string;
  device_id: string;
  occurred_at: string;
}

/** user_id（カード忘れ）による打刻リクエスト */
export interface PunchRequestByUserId {
  user_id: string;
  reason: string;
  device_id: string;
  occurred_at: string;
}

export type PunchRequest = PunchRequestByCard | PunchRequestByUserId;

export interface PunchResponse {
  attendance_id: string;
  user_id: string;
  action: 'check_in' | 'check_out';
  occurred_at: string;
  method?: 'card_idm' | 'user_id';
  message: string;
}

export interface PunchUserCandidate {
  id: string;
  name: string;
  full_name: string;
}

export interface PunchUserCandidateListResponse {
  users: PunchUserCandidate[];
}
