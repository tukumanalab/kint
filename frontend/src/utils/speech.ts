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

/** テキストを日本語音声で読み上げる。非対応環境では何もしない。 */
export function speak(text: string): void {
  const synth = getSynth();
  if (!synth || !text) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    synth.speak(utterance);
  } catch (e) {
    console.warn('[speech] speak failed:', e);
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
