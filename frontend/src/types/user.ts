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
  password: string;
}

export interface UserPatchRequest {
  name?: string;
  full_name?: string;
  email?: string;
  role?: 'admin' | 'employee';
  is_active?: boolean;
}
