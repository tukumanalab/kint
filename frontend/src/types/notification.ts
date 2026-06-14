export interface Notification {
  id: string;
  user_id: string;
  message: string;
  is_read: boolean;
  category?: string;
  reference_id?: string;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
  unread_count: number;
}
