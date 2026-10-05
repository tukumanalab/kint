import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FaceAvatar } from './FaceAvatar';

describe('FaceAvatar', () => {
  it('読み上げ中でなければ閉じた口を重ねる', () => {
    const { container } = render(<FaceAvatar state="greeting" speechText="こんにちは" />);
    expect(container.querySelector('.face-avatar__mouth')).not.toBeNull();
  });

  it('読み上げ中は閉じた口を重ねず、元画像の開いた口を見せる', () => {
    const { container } = render(
      <FaceAvatar state="greeting" speechText="こんにちは" speaking />,
    );
    expect(container.querySelector('.face-avatar__mouth')).toBeNull();
  });
});
