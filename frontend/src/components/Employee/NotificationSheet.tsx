import type { Notification } from '../../types/notification';
import { formatRelative } from './empUtils';
import { Sheet } from './Sheet';

interface Props {
  notifications: Notification[];
  unreadCount: number;
  onRead: (id: string) => Promise<void>;
  onReadAll: () => Promise<void>;
  onClose: () => void;
}

/** お知らせ一覧。未読をタップすると既読になる。 */
export function NotificationSheet({ notifications, unreadCount, onRead, onReadAll, onClose }: Props) {
  return (
    <Sheet
      title="お知らせ"
      subtitle={unreadCount > 0 ? `未読 ${unreadCount}件` : undefined}
      onClose={onClose}
      footer={
        unreadCount > 0 ? (
          <button
            type="button"
            className="emp-btn emp-btn--outline emp-btn--grow"
            onClick={() => void onReadAll()}
          >
            すべて既読にする
          </button>
        ) : undefined
      }
    >
      {notifications.length === 0 ? (
        <p className="emp-empty">お知らせはありません。</p>
      ) : (
        <ul className="emp-notes">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`emp-notice ${n.is_read ? '' : 'emp-notice--unread'}`}
                disabled={n.is_read}
                onClick={() => void onRead(n.id)}
              >
                <span className="emp-notice__dot" aria-hidden="true" />
                <span className="emp-notice__body">
                  <span className="emp-notice__msg">{n.message}</span>
                  <span className="emp-notice__time">
                    {formatRelative(n.created_at)}
                    {!n.is_read && ' ・ タップで既読'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
