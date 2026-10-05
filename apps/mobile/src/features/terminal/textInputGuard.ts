/**
 * xterm.js decodes soft-keyboard text (keydown 229 + `input`) by diffing the
 * helper textarea in a timeout. When characters arrive faster than that timeout
 * (fast IME commits, `adb shell input text`) the diff duplicates or drops
 * characters after a space. Plain, non-composing text edits are therefore
 * forwarded here, straight from the `input` event; composition keeps going
 * through xterm's own composition handling.
 *
 * The listeners sit on the container in the capture phase so they run before
 * xterm's capture listeners on the textarea.
 */
export function installTextInputGuard(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  send: (data: string) => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target === textarea && event.keyCode === 229 && !event.isComposing) {
      event.stopImmediatePropagation();
    }
  };

  const onInput = (event: Event): void => {
    if (event.target !== textarea) return;
    const input = event as InputEvent;
    if (input.isComposing) return;
    if (input.inputType === 'insertText' && input.data) {
      event.stopImmediatePropagation();
      send(input.data);
      textarea.value = '';
    } else if (input.inputType === 'deleteContentBackward') {
      event.stopImmediatePropagation();
      send('\x7f');
      textarea.value = '';
    }
  };

  container.addEventListener('keydown', onKeyDown, true);
  container.addEventListener('input', onInput, true);
  return () => {
    container.removeEventListener('keydown', onKeyDown, true);
    container.removeEventListener('input', onInput, true);
  };
}
