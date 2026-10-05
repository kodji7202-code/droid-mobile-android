import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../test/render-app';
import { ChatComposer } from './ChatComposer';

function setup() {
  const onSend = vi.fn();
  render(
    <AppProviders>
      <ChatComposer
        turnActive={false}
        workingState="idle"
        disabled={false}
        onSend={onSend}
        onInterrupt={() => undefined}
      />
    </AppProviders>,
  );
  return { onSend, input: screen.getByTestId('chat-attach-input') as HTMLInputElement };
}

const png = () => new File(['abc'], 'red.png', { type: 'image/png' });

describe('composer attachments', () => {
  it('previews a picked image, removes it, and sends only what is still attached', async () => {
    const { onSend, input } = setup();
    const user = userEvent.setup();
    await user.upload(input, [png(), new File(['ZEBRA'], 'token.txt', { type: 'text/plain' })]);
    expect(await screen.findByTestId('chat-attachment-1')).toHaveTextContent('token.txt');
    expect(screen.getByTestId('chat-attachment-0').querySelector('img')).toHaveAttribute(
      'src',
      `data:image/png;base64,${btoa('abc')}`,
    );

    await user.click(screen.getByTestId('chat-attachment-remove-0'));
    expect(screen.queryByTestId('chat-attachment-1')).toBeNull();

    await user.type(screen.getByTestId('chat-input'), 'read');
    await user.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('read', [
      { kind: 'file', name: 'token.txt', mediaType: 'text/plain', data: 'ZEBRA' },
    ]);
    expect(screen.queryByTestId('chat-attachments')).toBeNull();
  });

  it.each([
    ['setup.exe', 'application/x-msdownload'],
    ['archive.zip', 'application/zip'],
    ['clip.mp4', 'video/mp4'],
  ])('rejects %s without a chip and keeps send disabled', async (name, type) => {
    const { onSend, input } = setup();
    // applyAccept off: the browser would not filter a file chosen via "All files".
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(input, new File(['x'], name, { type }));
    const alert = await screen.findByTestId('chat-attach-error');
    expect(alert).toHaveTextContent(type);
    expect(alert).toHaveTextContent(name);
    expect(screen.queryByTestId('chat-attachment-0')).toBeNull();
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    await waitFor(() => expect(onSend).not.toHaveBeenCalled());
  });

  it('exposes the attach button under an accessible name', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBe(
      screen.getByTestId('chat-attach'),
    );
  });
});
