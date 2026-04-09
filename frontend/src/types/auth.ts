export interface UserProfile {
  id: string;
  role: 'admin' | 'employee';
  name: string;
  full_name: string;
  email: string;
}

export interface LoginRequest {
  account_id: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: UserProfile;
}
