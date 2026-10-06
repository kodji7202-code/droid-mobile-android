import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SlashCommand } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { ChatComposer } from './ChatComposer';

const COMMANDS: SlashCommand[] = [
  { name: 'val-hello', description: 'Validation hello command', argumentHint: '[topic]' },
  { name: 'review', description: 'Review the diff' },
];

function setup(loadCommands?: () => Promise<readonly SlashCommand[]>) {
  const onSend = vi.fn();
  const load = vi.fn(loadCommands ?? (async () => COMMANDS));
  render(
    <AppProviders>
      <ChatComposer
        turnActive={false}
        workingState="idle"
        disabled={false}
        loadCommands={load}
        onSend={onSend}
        onInterrupt={() => undefined}
      />
    </AppProviders>,
  );
  return { onSend, load, user: userEvent.setup(), input: screen.getByTestId('chat-input') };
}

describe('slash autocomplete', () => {
  it('opens on "/" with every command, its description and argument hint', async () => {
    const { user, input, load } = setup();
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    await user.type(input, '/');
    const popup = await screen.findByTestId('chat-slash-popup');
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-slash-item-val-hello')).toHaveTextContent(
      '/val-hello[topic]Validation hello command',
    );
    expect(screen.getByTestId('chat-slash-item-review')).toBeInTheDocument();
    expect(popup).toBeInTheDocument();
  });

  it('filters while typing and shows a no-match row', async () => {
    const { user, input } = setup();
    await user.type(input, '/val');
    await screen.findByTestId('chat-slash-item-val-hello');
    expect(screen.queryByTestId('chat-slash-item-review')).toBeNull();
    await user.clear(input);
    await user.type(input, '/zzzzqq');
    expect(await screen.findByTestId('chat-slash-empty')).toHaveTextContent('No matching commands');
    expect(screen.queryByTestId('chat-slash-item-val-hello')).toBeNull();
  });

  it('inserts "/<name> " without sending and closes the popup', async () => {
    const { user, input, onSend } = setup();
    await user.type(input, '/val');
    await user.click(await screen.findByTestId('chat-slash-item-val-hello'));
    expect(input).toHaveValue('/val-hello ');
    expect(input).toHaveFocus();
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('closes on Escape until the draft changes, and when the slash is deleted', async () => {
    const { user, input } = setup();
    await user.type(input, '/va');
    await screen.findByTestId('chat-slash-popup');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    expect(input).toHaveValue('/va');
    await user.type(input, 'l');
    expect(await screen.findByTestId('chat-slash-popup')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '/');
    await screen.findByTestId('chat-slash-popup');
    await user.clear(input);
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
  });

  it('reopens after "/" then Escape, clearing the draft and typing "/" again', async () => {
    const { user, input, load } = setup();
    await user.type(input, '/');
    await screen.findByTestId('chat-slash-popup');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();

    await user.clear(input);
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    await user.type(input, '/');

    expect(await screen.findByTestId('chat-slash-popup')).toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('selects with the keyboard', async () => {
    const { user, input } = setup();
    await user.type(input, '/');
    await screen.findByTestId('chat-slash-popup');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('/review ');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
  });

  it('opens only while the draft is a single slash token', async () => {
    const { user, input, load } = setup();
    await user.type(input, 'path/to');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    await user.clear(input);
    await user.click(input);
    await user.paste('/val-hello now');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('shows a loading row while the daemon answers and an error row when it fails', async () => {
    let fail: (reason: Error) => void = () => undefined;
    const { user, input } = setup(
      () =>
        new Promise<readonly SlashCommand[]>((_, reject) => {
          fail = reject;
        }),
    );
    await user.type(input, '/');
    expect(await screen.findByTestId('chat-slash-loading')).toHaveAccessibleName(
      'Loading commands',
    );
    fail(new Error('boom'));
    expect(await screen.findByTestId('chat-slash-error')).toHaveTextContent(
      'Could not load commands',
    );
  });

  it('reads the list again each time the popup opens', async () => {
    const { user, input, load } = setup();
    await user.type(input, '/');
    await screen.findByTestId('chat-slash-popup');
    await user.clear(input);
    await user.type(input, '/');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('keeps sending a plain "/" message possible without a loader', async () => {
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
    const user = userEvent.setup();
    await user.type(screen.getByTestId('chat-input'), '/anything');
    expect(screen.queryByTestId('chat-slash-popup')).toBeNull();
    await user.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('/anything', []);
  });
});
