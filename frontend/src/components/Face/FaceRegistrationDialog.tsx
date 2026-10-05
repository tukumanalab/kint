import { useEffect, useRef } from 'react';
import { FaceRegistration } from './FaceRegistration';
import type { FaceRegistrationProps } from './FaceRegistration';
import './FaceRegistrationDialog.css';

export interface FaceRegistrationDialogProps extends FaceRegistrationProps {
  title: string;
  onClose: () => void;
}

/**
 * 顔認証データの登録・削除をダイアログで行う共通コンポーネント。
 * マイページ（本人）とユーザー管理（管理者による代理登録）の両方から利用する。
 * 閉じると FaceRegistration がアンマウントされ、カメラも停止する。
 */
export function FaceRegistrationDialog({ title, onClose, ...registrationProps }: FaceRegistrationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      // jsdom など showModal 非対応環境では open 属性で代替する
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="face-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div className="face-dialog__inner">
        <div className="face-dialog__header">
          <h2 className="face-dialog__title">{title}</h2>
          <button type="button" className="face-dialog__close" aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
        </div>
        <FaceRegistration {...registrationProps} />
        <div className="face-dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
