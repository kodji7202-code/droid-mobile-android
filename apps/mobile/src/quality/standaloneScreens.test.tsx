import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAppAt } from '../test/render-app';
import { LockScreen } from '../features/lock/LockScreen';

// A prompt that never resolves keeps the lock screen on its first frame.
vi.mock('../platform/biometrics', () => ({
  biometrics: {
    isAvailable: vi.fn(() => new Promise(() => undefined)),
    authenticate: vi.fn(() => new Promise(() => undefined)),
  },
}));

function standaloneRule(): string {
  // `npm run test -w` runs from apps/mobile, the root project from the repo root.
  let dir = process.cwd();
  while (!existsSync(join(dir, 'apps/mobile/src/index.css'))) dir = dirname(dir);
  const css = readFileSync(join(dir, 'apps/mobile/src/index.css'), 'utf8');
  const match = /(^|\n)\.screen--standalone\s*\{([^}]*)\}/.exec(css);
  expect(match, '.screen--standalone rule exists').not.toBeNull();
  return match?.[2] ?? '';
}

describe('screens rendered outside the app shell', () => {
  it('give the Connect screen the shared screen padding class', () => {
    renderAppAt('/connect', { connected: false });
    expect(screen.getByTestId('connect-screen')).toHaveClass('screen', 'screen--standalone');
  });

  it('give the lock screen the shared screen padding class', () => {
    render(<LockScreen />);
    expect(screen.getByTestId('lock-screen')).toHaveClass('screen', 'screen--standalone');
  });

  it('pad every edge by at least 1rem and honor the safe-area insets', () => {
    const rule = standaloneRule();
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(rule).toContain(`max(1rem, env(safe-area-inset-${edge}, 0px))`);
    }
  });
});
