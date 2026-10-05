/** speechSynthesis (Web Speech API) を用いた日本語音声読み上げユーティリティ */

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return null;
  }
  return window.speechSynthesis;
}

/**
 * ユーザー操作のコンテキストで呼び出し、以降の speak() 呼び出しが
 * 自動再生制限の影響を受けにくくするための無音発話でロックを解除する。
 */
export function unlockSpeech(): void {
  const synth = getSynth();
  if (!synth) return;
  try {
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    synth.speak(utterance);
  } catch (e) {
    console.warn('[speech] unlock failed:', e);
  }
}

export interface SpeakCallbacks {
  /** 読み上げ開始時 */
  onStart?: () => void;
  /** 読み上げ終了時（エラー・キャンセル時も呼ばれる） */
  onEnd?: () => void;
}

/** 音声合成が使えない環境で「話している時間」を見積もる (1文字あたり約150ms) */
function estimateSpeechMs(text: string): number {
  return Math.min(6000, Math.max(800, text.length * 150));
}

/**
 * テキストを日本語音声で読み上げる。
 * 非対応環境・失敗時も、文字数から見積もった時間で onStart/onEnd を呼び、アバターの口の開閉に使えるようにする。
 */
export function speak(text: string, callbacks: SpeakCallbacks = {}): void {
  const { onStart, onEnd } = callbacks;
  if (!text) return;
  const fallback = () => {
    onStart?.();
    window.setTimeout(() => onEnd?.(), estimateSpeechMs(text));
  };
  const synth = getSynth();
  if (!synth) {
    fallback();
    return;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      onEnd?.();
    };
    utterance.onstart = () => onStart?.();
    utterance.onend = finish;
    utterance.onerror = finish;
    // 音声が再生されない環境（自動再生ブロック等）でも口が開きっぱなしにならないよう保険で閉じる
    onStart?.();
    window.setTimeout(finish, estimateSpeechMs(text) + 4000);
    synth.speak(utterance);
  } catch (e) {
    console.warn('[speech] speak failed:', e);
    fallback();
  }
}

/** 現在時刻帯に応じた挨拶語を返す (0時起点の24時間表記) */
function timeGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 11) return 'おはようございます';
  if (hour < 17) return 'こんにちは';
  return 'こんばんは';
}

/** 出退勤種別に応じたあいさつ文を組み立てる */
export function buildGreeting(
  kind: 'check_in' | 'check_out',
  userName: string,
  date: Date = new Date(),
): string {
  if (kind === 'check_in') {
    return `${timeGreeting(date)}、${userName}さん`;
  }
  return `お疲れさまでした、${userName}さん`;
}

/** 打刻完了後のフィードバック音声文を組み立てる */
export function buildResultSpeech(action: 'check_in' | 'check_out' | 'cancelled'): string {
  if (action === 'check_in') return '出勤を記録しました';
  if (action === 'check_out') return '退勤を記録しました';
  return '打刻を取り消しました';
}
