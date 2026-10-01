import './FaceAvatar.css';

export type FaceAvatarState = 'idle' | 'looking' | 'greeting' | 'success' | 'error';

export interface FaceAvatarProps {
  state: FaceAvatarState;
  speechText?: string | null;
}

/**
 * 打刻ページ用のイラストキャラクター (SVG + CSS アニメーション)。
 * 写真は使用せず、シンプルな図形のみで構成する。
 */
export function FaceAvatar({ state, speechText }: FaceAvatarProps) {
  return (
    <div className={`face-avatar face-avatar--${state}`}>
      {speechText && (
        <div className="face-avatar__bubble" role="status" aria-live="polite">
          {speechText}
        </div>
      )}
      <svg
        className="face-avatar__svg"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* 顔 */}
        <circle className="face-avatar__face" cx="100" cy="100" r="80" />
        {/* ほほ (success時のみ強調表示) */}
        <circle className="face-avatar__cheek" cx="55" cy="120" r="12" />
        <circle className="face-avatar__cheek" cx="145" cy="120" r="12" />
        {/* 目 */}
        <g className="face-avatar__eyes">
          <ellipse className="face-avatar__eye face-avatar__eye--left" cx="70" cy="90" rx="9" ry="12" />
          <ellipse className="face-avatar__eye face-avatar__eye--right" cx="130" cy="90" rx="9" ry="12" />
        </g>
        {/* 口 */}
        <path className="face-avatar__mouth" d="M 70 130 Q 100 150 130 130" />
      </svg>
    </div>
  );
}
