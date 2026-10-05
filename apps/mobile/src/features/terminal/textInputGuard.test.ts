import { describe, expect, it } from 'vitest';
import { installTextInputGuard } from './textInputGuard';

function setup() {
  const container = document.createElement('div');
  const textarea = document.createElement('textarea');
  container.appendChild(textarea);
  document.body.appendChild(container);
  const sent: string[] = [];
  const xtermSaw: string[] = [];
  // Registered first, like xterm's own capture listeners on the textarea.
  textarea.addEventListener('input', (e) => xtermSaw.push(`input:${(e as InputEvent).data}`), true);
  textarea.addEventListener('keydown', (e) => xtermSaw.push(`keydown:${e.keyCode}`), true);
  const off = installTextInputGuard(container, textarea, (d) => sent.push(d));
  return { container, textarea, sent, xtermSaw, off };
}

function input(textarea: HTMLTextAreaElement, init: InputEventInit) {
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
}

describe('installTextInputGuard', () => {
  it('forwards every plain text commit exactly once, spaces included', () => {
    const { textarea, sent, xtermSaw } = setup();
    for (const ch of 'echo hi-123') {
      textarea.value += ch;
      input(textarea, { inputType: 'insertText', data: ch });
    }
    expect(sent.join('')).toBe('echo hi-123');
    expect(sent).toHaveLength(11);
    expect(xtermSaw).toEqual([]);
    expect(textarea.value).toBe('');
  });

  it('keeps xterm from seeing keydown 229 outside composition', () => {
    const { textarea, xtermSaw } = setup();
    const ev = new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 });
    textarea.dispatchEvent(ev);
    expect(xtermSaw).toEqual([]);
  });

  it('leaves composition and other keys to xterm', () => {
    const { textarea, sent, xtermSaw } = setup();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 13 }));
    input(textarea, { inputType: 'insertCompositionText', data: 'he', isComposing: true });
    input(textarea, { inputType: 'insertText', data: 'x', isComposing: true });
    expect(sent).toEqual([]);
    expect(xtermSaw).toEqual(['keydown:13', 'input:he', 'input:x']);
  });

  it('turns a soft-keyboard backspace into DEL', () => {
    const { textarea, sent } = setup();
    input(textarea, { inputType: 'deleteContentBackward' });
    expect(sent).toEqual(['\x7f']);
  });

  it('stops intercepting after it is removed', () => {
    const { textarea, sent, off } = setup();
    off();
    input(textarea, { inputType: 'insertText', data: 'a' });
    expect(sent).toEqual([]);
  });

  it('does not resend physical-keyboard characters xterm already sent (uppercase, lowercase)', () => {
    const { textarea, sent, xtermSaw } = setup();
    for (const [ch, code] of [
      ['D', 68],
      ['d', 68],
    ] as const) {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: ch,
          keyCode: code,
          shiftKey: ch === 'D',
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent('keypress', { bubbles: true, charCode: ch.charCodeAt(0) }),
      );
      textarea.value += ch;
      input(textarea, { inputType: 'insertText', data: ch });
      textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch, keyCode: code }));
    }
    expect(sent).toEqual([]);
    expect(xtermSaw).toEqual(['keydown:68', 'input:D', 'keydown:68', 'input:d']);
  });

  it('keeps a held physical key from swallowing overlapping fast physical input', () => {
    const { textarea, sent } = setup();
    for (const code of [68, 79]) {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: code }));
    }
    input(textarea, { inputType: 'insertText', data: 'D' });
    input(textarea, { inputType: 'insertText', data: 'O' });
    expect(sent).toEqual([]);
  });

  it('intercepts soft-keyboard text again after a physical key was released', () => {
    const { textarea, sent } = setup();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 68 }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, keyCode: 68 }));
    input(textarea, { inputType: 'insertText', data: 'x' });
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
    input(textarea, { inputType: 'insertText', data: 'Y' });
    expect(sent).toEqual(['x', 'Y']);
  });
});
