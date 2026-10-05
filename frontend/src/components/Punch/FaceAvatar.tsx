import type { ReactNode } from 'react';
import avatarImage from '../../assets/punch-avatar.webp';
import './FaceAvatar.css';

export type FaceAvatarState = 'idle' | 'looking' | 'greeting' | 'success' | 'error';

export interface FaceAvatarProps {
  state: FaceAvatarState;
  speechText?: string | null;
  /** 音声読み上げ中なら true（口を開ける） */
  speaking?: boolean;
  /** 顔の横に表示する要素（打刻ページではカメラプレビュー） */
  faceSide?: ReactNode;
}

/**
 * 打刻ページ用のイラストアバター。
 * 状態に応じて CSS アニメーション（待機の揺れ・覗き込み・弾むあいさつ・成功のジャンプ・エラーの首振り）を切り替える。
 * 口は音声読み上げ中（speaking）のみ開け、それ以外は閉じる。
 */
export function FaceAvatar({ state, speechText, speaking = false, faceSide }: FaceAvatarProps) {
  return (
    <div className={`face-avatar face-avatar--${state}`} data-state={state}>
      {speechText && (
        <div className="face-avatar__bubble" role="status" aria-live="polite">
          {speechText}
        </div>
      )}
      <div className="face-avatar__figure">
        <div className="face-avatar__body">
          <img className="face-avatar__image" src={avatarImage} alt="" aria-hidden="true" draggable={false} />
          {/* 発言中は元画像の開いた口をそのまま見せ、それ以外は閉じた口を重ねる */}
          {!speaking && (
            <span className="face-avatar__mouth-area" aria-hidden="true">
              <span className="face-avatar__mouth" />
            </span>
          )}
        </div>
        {faceSide && <div className="face-avatar__face-side">{faceSide}</div>}
      </div>
      <div className="face-avatar__shadow" aria-hidden="true" />
    </div>
  );
}
