import React, { useEffect, useRef } from 'react';
import type { Notification } from '../../types/notification';
import './NotificationPopover.css';

interface NotificationPopoverProps {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;
  onClose: () => void;
  onRead: (id: string) => Promise<void>;
  onReadAll: () => Promise<void>;
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    if (diffMs < 0) return 'たった今'; // 時差などの対策
    
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'たった今';
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    if (diffDays < 7) return `${diffDays}日前`;
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  notifications,
  unreadCount,
  isOpen,
  onClose,
  onRead,
  onReadAll,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  // ポップオーバーの外側をクリックした時に閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.app-nav__notification-btn')
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="notification-popover" ref={popoverRef}>
      <div className="notification-popover__header">
        <h3 className="notification-popover__title">お知らせ</h3>
        {unreadCount > 0 && (
          <button
            type="button"
            className="notification-popover__read-all-btn"
            onClick={onReadAll}
          >
            すべて既読にする
          </button>
        )}
      </div>
      
      <div className="notification-popover__content">
        {notifications.length === 0 ? (
          <div className="notification-popover__empty">
            お知らせはありません
          </div>
        ) : (
          <ul className="notification-popover__list">
            {notifications.map((notif) => (
              <li
                key={notif.id}
                className={`notification-popover__item ${
                  notif.is_read ? '' : 'notification-popover__item--unread'
                } notification-popover__item--${notif.category || 'general'}`}
              >
                <div className="notification-popover__item-body">
                  <p className="notification-popover__item-text">{notif.message}</p>
                  <span className="notification-popover__item-time">
                    {formatTime(notif.created_at)}
                  </span>
                </div>
                {!notif.is_read && (
                  <button
                    type="button"
                    className="notification-popover__item-read-btn"
                    onClick={() => onRead(notif.id)}
                    title="既読にする"
                  >
                    <span className="notification-popover__read-dot" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
