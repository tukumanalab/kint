import { useCallback, useEffect, useRef, useState } from 'react';
import { speak } from '../utils/speech';
import type { FaceAvatarState } from '../components/Punch/FaceAvatar';

/** react() で状態を保持するデフォルト時間 (ms) */
export const DEFAULT_REACT_HOLD_MS = 3000;

export interface UsePunchAvatar {
  avatarState: FaceAvatarState;
  speechText: string;
  /** 読み上げ中なら true（アバターの口を開ける） */
  speaking: boolean;
  /** 吹き出しを表示して読み上げる。読み上げ中のみ speaking が true になる */
  say: (text: string) => void;
  /** アバターの状態を直接変更する（保留中の react() の復帰タイマーは破棄する） */
  setAvatarState: (state: FaceAvatarState) => void;
  /** 吹き出しを消す */
  clearSpeech: () => void;
  /** 指定した状態と発話を表示し、holdMs 後に基本状態へ戻す */
  react: (state: FaceAvatarState, text: string, holdMs?: number) => void;
  /** react() 後に戻る基本状態を設定する（顔認証が待ち受け中なら 'looking'、それ以外は 'idle'） */
  setBaseState: (state: FaceAvatarState) => void;
}

/**
 * 打刻ページのアバター状態・吹き出し・読み上げを一元管理するフック。
 * NFC 打刻と顔認証打刻のどちらの結果でも同じアバターが反応できるよう、PunchPage が保持して共有する。
 */
export function usePunchAvatar(): UsePunchAvatar {
  const [avatarState, setAvatarStateInternal] = useState<FaceAvatarState>('idle');
  const [speechText, setSpeechText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const speechIdRef = useRef(0);
  const baseStateRef = useRef<FaceAvatarState>('idle');
  const holdTimerRef = useRef<number | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // アンマウント時に復帰タイマーを破棄し、進行中の発話の口パク更新を無効化する
  useEffect(() => {
    return () => {
      clearHoldTimer();
      speechIdRef.current += 1;
    };
  }, [clearHoldTimer]);

  const say = useCallback((text: string) => {
    setSpeechText(text);
    const id = ++speechIdRef.current;
    speak(text, {
      onStart: () => {
        if (speechIdRef.current === id) setSpeaking(true);
      },
      onEnd: () => {
        if (speechIdRef.current === id) setSpeaking(false);
      },
    });
  }, []);

  const setAvatarState = useCallback(
    (state: FaceAvatarState) => {
      clearHoldTimer();
      setAvatarStateInternal(state);
    },
    [clearHoldTimer],
  );

  const clearSpeech = useCallback(() => {
    clearHoldTimer();
    setSpeechText('');
  }, [clearHoldTimer]);

  const setBaseState = useCallback((state: FaceAvatarState) => {
    baseStateRef.current = state;
  }, []);

  const react = useCallback(
    (state: FaceAvatarState, text: string, holdMs: number = DEFAULT_REACT_HOLD_MS) => {
      clearHoldTimer();
      setAvatarStateInternal(state);
      if (text) {
        say(text);
      } else {
        setSpeechText('');
      }
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        setAvatarStateInternal(baseStateRef.current);
        setSpeechText('');
      }, holdMs);
    },
    [clearHoldTimer, say],
  );

  return { avatarState, speechText, speaking, say, setAvatarState, clearSpeech, react, setBaseState };
}
