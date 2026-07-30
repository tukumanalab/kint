export interface UserProfile {
  id: string;
  role: 'admin' | 'employee';
  name: string;
  full_name: string;
  name_kana?: string | null;
  department?: string | null;
  worker_id?: string | null;
  email: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: UserProfile;
}
