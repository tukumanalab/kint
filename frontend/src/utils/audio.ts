let audioCtx: AudioContext | null = null;

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as WindowWithWebkit).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser');
    }
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/**
 * ユーザー操作のコンテキストで呼び出し、AudioContext を有効化する
 */
export async function initAudio(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch (e) {
    console.warn('[Audio] Failed to initialize AudioContext:', e);
  }
}

/**
 * 周波数、長さ、波形を指定して短い単音を再生する
 */
function playTone(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  startTime: number,
  type: OscillatorType = 'sine'
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  
  // 音量エンベロープ (ポップノイズ防止のためにフェードアウトさせる)
  gain.gain.setValueAtTime(0.12, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/**
 * 打刻成功時の効果音を再生
 */
export function playPunchSuccess(action: 'check_in' | 'check_out' | 'cancelled') {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    if (action === 'check_in') {
      // 出勤: ピピッ (高音2回)
      playTone(ctx, 880, 0.08, now);
      playTone(ctx, 880, 0.08, now + 0.12);
    } else if (action === 'check_out') {
      // 退勤: ピプー (高音 -> 中音)
      playTone(ctx, 880, 0.08, now);
      playTone(ctx, 587.33, 0.20, now + 0.12);
    } else {
      // 打刻取消等: ピッ (単音)
      playTone(ctx, 880, 0.15, now);
    }
  } catch (e) {
    console.warn('[Audio] Success sound playback failed:', e);
  }
}

/**
 * 打刻エラー時の効果音を再生
 */
export function playPunchError() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    // エラー: ブー (低い警告音、鋸歯状波)
    playTone(ctx, 180, 0.35, now, 'sawtooth');
  } catch (e) {
    console.warn('[Audio] Error sound playback failed:', e);
  }
}
