import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePunchAvatar } from './usePunchAvatar';
import * as speech from '../utils/speech';

describe('usePunchAvatar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(speech, 'speak').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('react() の後 holdMs が過ぎると基本状態 (idle) に戻り吹き出しが消える', () => {
    const { result } = renderHook(() => usePunchAvatar());

    act(() => result.current.react('success', '出勤を記録しました', 3000));
    expect(result.current.avatarState).toBe('success');
    expect(result.current.speechText).toBe('出勤を記録しました');

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.avatarState).toBe('success');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.avatarState).toBe('idle');
    expect(result.current.speechText).toBe('');
  });

  it('setBaseState で指定した基本状態に戻る', () => {
    const { result } = renderHook(() => usePunchAvatar());

    act(() => {
      result.current.setBaseState('looking');
      result.current.react('error', '打刻できませんでした', 1000);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.avatarState).toBe('looking');
  });

  it('setAvatarState で直接状態を変えると react() の復帰タイマーは破棄される', () => {
    const { result } = renderHook(() => usePunchAvatar());

    act(() => result.current.react('success', 'テスト', 1000));
    act(() => result.current.setAvatarState('greeting'));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.avatarState).toBe('greeting');
  });
});
