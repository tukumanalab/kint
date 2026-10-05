/** 顔認証データの登録状況 */
export interface FaceStatus {
  registered: boolean;
  count: number;
  updated_at: string | null;
}

/** 顔ディスクリプタ登録リクエスト (1〜5件 × 128次元) */
export interface FaceDescriptorPutRequest {
  descriptors: number[][];
}

/** 顔認証打刻の設定 (打刻端末向け) */
export interface FacePunchConfig {
  enabled: boolean;
  countdown_seconds: number;
  cooldown_seconds: number;
}

/** 顔認証テスト結果 (他ユーザーの情報は含まれない) */
export interface FaceVerifyResult {
  result: 'recognized' | 'recognized_with_confirmation' | 'not_recognized';
  reason: 'ok' | 'too_far' | 'other_user_closer' | 'ambiguous';
  distance: number;
  threshold: number;
  threshold_no_shift: number;
  has_shift: boolean;
}

/** 顔照合リクエスト */
export interface FaceIdentifyRequest {
  descriptor: number[];
}

/** 顔照合レスポンス */
export interface FaceIdentifyResponse {
  matched: boolean;
  user_id: string | null;
  user_name: string | null;
  distance: number | null;
  has_shift: boolean;
  requires_confirmation: boolean;
  face_match_token: string | null;
  greeting_kind: 'check_in' | 'check_out' | null;
}
