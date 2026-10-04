import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AskUserAnswer,
  AskUserRequest,
  DaemonConnection,
  NormalizedEvent,
  PermissionAnswer,
  PermissionRequest,
} from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useInteractionStore } from '../../stores/interactions';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';

type Script = (prompt: string) => AsyncGenerator<NormalizedEvent, void, undefined>;

function setup(script: Script) {
  const interrupt = vi.fn(async () => undefined);
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream: vi.fn(script),
    interrupt,
  };
  const connection = { resumeSession: async () => handle } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionScreen />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { interrupt };
}

afterEach(() => {
  act(() => {
    useInteractionStore.getState().reset();
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('chat-input'), text);
  await user.click(screen.getByTestId('chat-send'));
  return user;
}

function permissionRequest(
  details: Record<string, unknown>,
  name = 'Create',
  options = ['proceed_once', 'proceed_always', 'cancel'],
): PermissionRequest {
  return {
    options: options.map((value) => ({ value, label: value })),
    toolUses: [
      {
        toolUse: { type: 'tool_use', id: 'tool-1', name, input: { file_path: 'hello.txt' } },
        details,
        confirmationType: 'create',
      },
    ],
  } as unknown as PermissionRequest;
}

const createDetails = {
  type: 'create',
  filePath: 'C:\\work\\proj\\hello.txt',
  fileName: 'hello.txt',
  content: 'hi',
};

/** Starts a turn that blocks on the daemon until the permission promise settles. */
function permissionTurn(request: PermissionRequest, answers: PermissionAnswer[]): Script {
  return async function* () {
    yield { type: 'working_state', state: 'waiting_for_tool_confirmation' };
    answers.push(await useInteractionStore.getState().requestPermission('s1', request));
    yield {
      type: 'tool_result',
      toolName: 'Create',
      toolUseId: 'tool-1',
      content: 'done',
      isError: false,
    };
  };
}

describe('permission requests', () => {
  it('shows the file and content, blocks the turn and answers approve once', async () => {
    const answers: PermissionAnswer[] = [];
    setup(permissionTurn(permissionRequest(createDetails), answers));
    await send('Create a file hello.txt containing hi');

    const dialog = await screen.findByTestId('permission-dialog');
    expect(dialog).toHaveTextContent('hello.txt');
    expect(screen.getByTestId('permission-diff')).toHaveTextContent('+hi');
    expect(screen.getByTestId('chat-working')).toHaveAttribute(
      'data-state',
      'waiting_for_tool_confirmation',
    );
    expect(answers).toEqual([]);

    await userEvent.click(screen.getByTestId('permission-approve-once'));
    await waitFor(() => expect(answers).toEqual(['proceed_once']));
    await waitFor(() => expect(screen.queryByTestId('permission-dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId('tool-call-tool-1')).toHaveAttribute('data-state', 'completed'),
    );
  });

  it('answers approve always with the always option', async () => {
    const answers: PermissionAnswer[] = [];
    setup(permissionTurn(permissionRequest(createDetails), answers));
    await send('x');
    await userEvent.click(await screen.findByTestId('permission-approve-always'));
    await waitFor(() => expect(answers).toEqual(['proceed_always']));
  });

  it('answers deny with cancel and shows the tool call as denied', async () => {
    const answers: PermissionAnswer[] = [];
    setup(permissionTurn(permissionRequest(createDetails), answers));
    await send('x');
    await userEvent.click(await screen.findByTestId('permission-deny'));
    await waitFor(() => expect(answers).toEqual(['cancel']));
    await waitFor(() =>
      expect(screen.getByTestId('tool-call-tool-1')).toHaveAttribute('data-state', 'denied'),
    );
  });

  it('shows the command text for an execution request', async () => {
    const request = permissionRequest(
      { type: 'exec', command: 'echo', fullCommand: 'echo droid-ok' },
      'Execute',
    );
    setup(permissionTurn(request, []));
    await send('x');
    expect(await screen.findByTestId('permission-command')).toHaveTextContent('echo droid-ok');
  });

  it('hides the always button when the daemon does not offer it', async () => {
    setup(
      permissionTurn(permissionRequest(createDetails, 'Create', ['proceed_once', 'cancel']), []),
    );
    await send('x');
    await screen.findByTestId('permission-dialog');
    expect(screen.queryByTestId('permission-approve-always')).toBeNull();
  });

  it('cancels the request and shows an expired notice when the connection drops', async () => {
    const answers: PermissionAnswer[] = [];
    setup(permissionTurn(permissionRequest(createDetails), answers));
    await send('x');
    await screen.findByTestId('permission-dialog');
    act(() => useConnectionStore.setState({ status: 'reconnecting' }));
    await waitFor(() => expect(answers).toEqual(['cancel']));
    expect(screen.queryByTestId('permission-dialog')).toBeNull();
    expect(await screen.findByTestId('interaction-expired')).toBeInTheDocument();
  });
});

describe('AskUser requests', () => {
  const request = {
    toolCallId: 'ask-1',
    questions: [
      { index: 0, topic: 'Color', question: 'Pick red or blue', options: ['red', 'blue'] },
    ],
  } as unknown as AskUserRequest;

  function askTurn(answers: AskUserAnswer[]): Script {
    return async function* () {
      answers.push(await useInteractionStore.getState().requestAskUser('s1', request));
      yield { type: 'working_state', state: 'thinking' };
    };
  }

  it('keeps submit disabled until an option is chosen and sends the chosen answer', async () => {
    const answers: AskUserAnswer[] = [];
    setup(askTurn(answers));
    await send('ask');
    expect(await screen.findByTestId('askuser-dialog')).toHaveTextContent('Pick red or blue');
    expect(screen.getByTestId('askuser-submit')).toBeDisabled();

    await userEvent.click(screen.getByLabelText('blue'));
    expect(screen.getByTestId('askuser-submit')).toBeEnabled();
    await userEvent.click(screen.getByTestId('askuser-submit'));

    await waitFor(() =>
      expect(answers).toEqual([
        { answers: [{ index: 0, question: 'Pick red or blue', answer: 'blue' }] },
      ]),
    );
    await waitFor(() => expect(screen.queryByTestId('askuser-dialog')).toBeNull());
  });

  it('sends a cancelled response when the dialog is cancelled', async () => {
    const answers: AskUserAnswer[] = [];
    setup(askTurn(answers));
    await send('ask');
    await userEvent.click(await screen.findByTestId('askuser-cancel'));
    await waitFor(() => expect(answers).toEqual([{ cancelled: true, answers: [] }]));
  });
});

describe('interrupt', () => {
  it('keeps the partial text, marks it stopped and re-enables send', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { interrupt } = setup(async function* () {
      yield {
        type: 'assistant_text_delta',
        messageId: 'm1',
        blockIndex: 0,
        text: '1\n2\n3',
      };
      await gate;
      yield {
        type: 'result',
        sessionId: 's1',
        subtype: 'success',
        success: true,
        interrupted: true,
        durationMs: 1,
        text: '',
        turnCount: 1,
        tokenUsage: null,
      };
    });
    const user = await send('count');
    const stop = await screen.findByTestId('chat-interrupt');
    await screen.findByText(/1\s+2\s+3/);
    await user.click(stop);
    expect(interrupt).toHaveBeenCalledOnce();
    act(() => finish());

    await waitFor(() => expect(screen.queryByTestId('chat-interrupt')).toBeNull());
    expect(screen.getByTestId('msg-stopped-1')).toBeInTheDocument();
    expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('3');
    await user.type(screen.getByTestId('chat-input'), 'next');
    expect(screen.getByTestId('chat-send')).toBeEnabled();
  });
});

describe('replayed requests', () => {
  it('shows one dialog for a request delivered twice and answers both deliveries', async () => {
    const answers: PermissionAnswer[] = [];
    const request = permissionRequest(createDetails);
    setup(async function* () {
      yield { type: 'working_state', state: 'thinking' };
    });
    await screen.findByTestId('chat-input');
    act(() => {
      const store = useInteractionStore.getState();
      void store.requestPermission('s1', request).then((a) => answers.push(a));
      void store.requestPermission('s1', request).then((a) => answers.push(a));
    });
    expect(await screen.findAllByTestId('permission-dialog')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('permission-approve-once'));
    await waitFor(() => expect(answers).toEqual(['proceed_once', 'proceed_once']));
    expect(screen.queryByTestId('permission-dialog')).toBeNull();
  });
});
