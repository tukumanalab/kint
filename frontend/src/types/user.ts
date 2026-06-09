export interface UserResponse {
  id: string;
  name: string;
  full_name: string;
  email: string;
  role: 'admin' | 'employee';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsersListResponse {
  users: UserResponse[];
}

export interface UserCreateRequest {
  id: string;
  name: string;
  full_name: string;
  email: string;
  role: 'admin' | 'employee';
}

export interface UserPatchRequest {
  name?: string;
  full_name?: string;
  email?: string;
  role?: 'admin' | 'employee';
  is_active?: boolean;
}

export interface MeProfileUpdateRequest {
  name?: string;
  full_name?: string;
}

export interface MeCardPatchRequest {
  name?: string | null;
}

export interface MeCardRegistrationRequest {
  card_idm: string;
  name?: string;
}

export interface MeCardRegistrationResponse {
  card_id: string;
  card_idm: string;
  name: string | null;
  is_active: boolean;
}

export interface MeCardListItem {
  card_id: string;
  card_idm: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface EmailChangeRequestCreate {
  new_email: string;
}

export interface EmailChangeRequestAcceptedResponse {
  status: 'pending_confirmation';
  requested_email: string;
  expires_at?: string;
}



export interface EmailVerificationConfirmRequest {
  token: string;
}

export interface EmailVerificationConfirmResponse {
  verification_type: 'signup' | 'email_change';
  email: string;
  status: 'confirmed';
}
