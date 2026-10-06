import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomModel, DaemonConnection } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';

const DUMMY = 'sk-dummy-0000-NOTAREALKEY';

const SEEDED: CustomModel = {
  rawIndex: 0,
  model: 'val-model-1',
  displayName: 'val-byok',
  provider: 'generic-chat-completion-api',
  baseUrl: 'http://127.0.0.1:3198/v1',
  hasApiKey: true,
  apiKeyMask: '••••LKEY',
  isValid: true,
};

type Api = DaemonConnection['customModels'];

function setup(initial: CustomModel[] = [], overrides: Partial<Api> = {}) {
  const state = { models: initial.map((item) => ({ ...item })) };
  const customModels = {
    list: vi.fn(async () => state.models.map((item) => ({ ...item }))),
    save: vi.fn(
      async (
        input: {
          provider: string;
          model: string;
          displayName?: string;
          baseUrl?: string;
          apiKey?: string;
        },
        target?: { rawIndex: number; model: string },
      ) => {
        const entry: CustomModel = {
          rawIndex: target?.rawIndex ?? state.models.length,
          model: input.model,
          provider: input.provider,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          hasApiKey: Boolean(input.apiKey) || Boolean(target),
          ...(input.apiKey || target ? { apiKeyMask: '••••LKEY' } : {}),
          isValid: true,
        };
        if (target) state.models[target.rawIndex] = entry;
        else state.models.push(entry);
      },
    ),
    remove: vi.fn(async (target: { rawIndex: number }) => {
      state.models = state.models
        .filter((item) => item.rawIndex !== target.rawIndex)
        .map((item, index) => ({ ...item, rawIndex: index }));
    }),
    ...overrides,
  } as unknown as Api;
  const connection = { customModels } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/extensions/custom-models', { connection });
  return { state, customModels };
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

type User = ReturnType<typeof userEvent.setup>;

async function fill(user: User, testId: string, value: string) {
  const input = await screen.findByTestId(testId);
  await user.clear(input);
  if (value) await user.type(input, value);
}

async function fillAdd(user: User, overrides: Record<string, string> = {}) {
  const values = {
    'custom-model-form-display-name': 'val-byok2',
    'custom-model-form-model': 'val-model-2',
    'custom-model-form-base-url': 'http://127.0.0.1:3198/v1',
    'custom-model-form-api-key': DUMMY,
    ...overrides,
  };
  for (const [testId, value] of Object.entries(values)) await fill(user, testId, value);
}

describe('CustomModelsScreen list', () => {
  it('shows a labelled loading state while the daemon list is pending', () => {
    setup([], { list: () => new Promise(() => {}) } as Partial<Api>);
    expect(screen.getByTestId('custom-models-loading')).toHaveAccessibleName(
      'Loading custom models',
    );
  });

  it('shows the empty state with an add action', async () => {
    setup([]);
    const empty = await screen.findByTestId('custom-models-empty');
    expect(empty).toHaveTextContent('No custom models');
    expect(within(empty).getByTestId('custom-model-add')).toBeInTheDocument();
    expect(screen.queryByTestId('custom-models-list')).toBeNull();
  });

  it('shows name, provider, model id, base URL and only the masked key', async () => {
    const { customModels } = setup([SEEDED]);
    const row = await screen.findByTestId('custom-model-row-val-model-1');
    expect(within(row).getByTestId('custom-model-name-val-model-1')).toHaveTextContent('val-byok');
    expect(within(row).getByTestId('custom-model-provider-val-model-1')).toHaveTextContent(
      'Generic chat-completion API',
    );
    expect(within(row).getByTestId('custom-model-id-val-model-1')).toHaveTextContent('val-model-1');
    expect(within(row).getByTestId('custom-model-url-val-model-1')).toHaveTextContent(
      'http://127.0.0.1:3198/v1',
    );
    expect(within(row).getByTestId('custom-model-key-val-model-1')).toHaveTextContent(
      'API key ••••LKEY',
    );
    expect(document.body.textContent).not.toContain('sk-dummy');
    expect(document.body.textContent).not.toContain('NOTAREALKEY');
    expect(customModels.list).toHaveBeenCalled();
  });

  it('says there is no key when the entry has none', async () => {
    setup([{ ...SEEDED, hasApiKey: false }].map(({ apiKeyMask: _mask, ...rest }) => rest));
    expect(await screen.findByTestId('custom-model-key-val-model-1')).toHaveTextContent(
      'No API key',
    );
  });

  it('shows an error with retry when the daemon does not answer, then recovers', async () => {
    const list = vi
      .fn<() => Promise<CustomModel[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([SEEDED]);
    setup([], { list } as Partial<Api>);
    expect(await screen.findByTestId('custom-models-error')).toHaveTextContent(
      'Could not load custom models',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('custom-models-list')).toBeInTheDocument();
  });
});

describe('CustomModelsScreen add', () => {
  it('offers exactly the three providers and a password field for the key', async () => {
    const user = userEvent.setup();
    setup([]);
    await user.click(await screen.findByTestId('custom-model-add'));
    const options = within(screen.getByTestId('custom-model-form-provider'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['anthropic', 'openai', 'generic-chat-completion-api']);
    expect(screen.getByTestId('custom-model-form-api-key')).toHaveAttribute('type', 'password');
  });

  it('saves the typed key once, shows the masked row and never prints the key', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-add'));
    await user.selectOptions(screen.getByTestId('custom-model-form-provider'), 'openai');
    await fillAdd(user);
    expect(document.body.innerHTML).not.toContain('NOTAREALKEY');
    await user.click(screen.getByTestId('custom-model-form-submit'));
    await waitFor(() =>
      expect(customModels.save).toHaveBeenCalledWith(
        {
          provider: 'openai',
          displayName: 'val-byok2',
          model: 'val-model-2',
          baseUrl: 'http://127.0.0.1:3198/v1',
          apiKey: DUMMY,
        },
        undefined,
      ),
    );
    const row = await screen.findByTestId('custom-model-row-val-model-2');
    expect(within(row).getByTestId('custom-model-key-val-model-2')).toHaveTextContent('••••LKEY');
    expect(screen.queryByTestId('custom-model-sheet')).toBeNull();
    expect(screen.getByTestId('custom-models-notice')).toHaveTextContent('val-byok2 added.');
    expect(document.body.textContent).not.toContain('NOTAREALKEY');
  });

  it('rejects an empty model id inline, keeps the values and sends nothing', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-add'));
    await fillAdd(user, { 'custom-model-form-model': '' });
    await user.click(screen.getByTestId('custom-model-form-submit'));
    expect(screen.getByTestId('custom-model-form-model-error')).toHaveTextContent(
      'Enter a model ID.',
    );
    expect(screen.getByTestId('custom-model-form-display-name')).toHaveValue('val-byok2');
    expect(screen.getByTestId('custom-model-form-base-url')).toHaveValue(
      'http://127.0.0.1:3198/v1',
    );
    expect(customModels.save).not.toHaveBeenCalled();
  });

  it('rejects a base URL that is not http or https and keeps the values', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-add'));
    await fillAdd(user, { 'custom-model-form-base-url': 'ftp://x' });
    await user.click(screen.getByTestId('custom-model-form-submit'));
    expect(screen.getByTestId('custom-model-form-base-url-error')).toHaveTextContent(
      'Use a URL that starts with http:// or https://.',
    );
    expect(screen.getByTestId('custom-model-form-base-url')).toHaveValue('ftp://x');
    expect(screen.getByTestId('custom-model-form-model')).toHaveValue('val-model-2');
    expect(customModels.save).not.toHaveBeenCalled();
    expect(screen.queryByTestId('custom-model-row-val-model-2')).toBeNull();
  });

  it('requires a key on add and refuses a model id that already exists', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-add'));
    await fillAdd(user, {
      'custom-model-form-model': 'val-model-1',
      'custom-model-form-api-key': '',
    });
    await user.click(screen.getByTestId('custom-model-form-submit'));
    expect(screen.getByTestId('custom-model-form-model-error')).toHaveTextContent(
      'A custom model with this ID already exists.',
    );
    expect(screen.getByTestId('custom-model-form-api-key-error')).toHaveTextContent(
      'Enter an API key.',
    );
    expect(customModels.save).not.toHaveBeenCalled();
  });

  it('keeps the form open with the daemon text when saving fails, without the key', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new Error('The daemon rejected the model.');
    });
    setup([], { save } as unknown as Partial<Api>);
    await user.click(await screen.findByTestId('custom-model-add'));
    await fillAdd(user);
    await user.click(screen.getByTestId('custom-model-form-submit'));
    expect(await screen.findByTestId('custom-model-form-error')).toHaveTextContent(
      'The daemon rejected the model.',
    );
    expect(screen.getByTestId('custom-model-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('custom-model-form-model')).toHaveValue('val-model-2');
  });
});

describe('CustomModelsScreen edit', () => {
  it('opens with an empty key field and never the stored key', async () => {
    const user = userEvent.setup();
    setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-edit-val-model-1'));
    const key = screen.getByTestId('custom-model-form-api-key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('placeholder', 'Leave empty to keep the stored key');
    expect(screen.getByTestId('custom-model-sheet')).toHaveTextContent('Stored key ••••LKEY');
    expect(screen.getByTestId('custom-model-form-model')).toHaveValue('val-model-1');
    expect(document.body.textContent).not.toContain('NOTAREALKEY');
  });

  it('renames without sending an apiKey field and keeps the mask', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-edit-val-model-1'));
    await fill(user, 'custom-model-form-display-name', 'val-byok-renamed');
    await user.click(screen.getByTestId('custom-model-form-submit'));
    await waitFor(() => expect(customModels.save).toHaveBeenCalledTimes(1));
    const [input, target] = vi.mocked(customModels.save).mock.calls[0]!;
    expect('apiKey' in input).toBe(false);
    expect(input.displayName).toBe('val-byok-renamed');
    expect(target).toEqual({ rawIndex: 0, model: 'val-model-1' });
    expect(await screen.findByTestId('custom-model-name-val-model-1')).toHaveTextContent(
      'val-byok-renamed',
    );
    expect(screen.getByTestId('custom-model-key-val-model-1')).toHaveTextContent('••••LKEY');
  });

  it('allows keeping the same model id when editing', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-edit-val-model-1'));
    await user.click(screen.getByTestId('custom-model-form-submit'));
    await waitFor(() => expect(customModels.save).toHaveBeenCalled());
    expect(screen.queryByTestId('custom-model-form-model-error')).toBeNull();
  });
});

describe('CustomModelsScreen delete', () => {
  it('asks for confirmation naming the model; Cancel keeps it, Confirm removes it', async () => {
    const user = userEvent.setup();
    const { customModels } = setup([SEEDED]);
    await user.click(await screen.findByTestId('custom-model-delete-val-model-1'));
    const dialog = screen.getByTestId('custom-model-delete-dialog');
    expect(dialog).toHaveTextContent('Delete val-byok?');
    await user.click(screen.getByTestId('custom-model-delete-dialog-cancel'));
    expect(customModels.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('custom-model-row-val-model-1')).toBeInTheDocument();

    await user.click(screen.getByTestId('custom-model-delete-val-model-1'));
    await user.click(screen.getByTestId('custom-model-delete-dialog-confirm'));
    await waitFor(() =>
      expect(customModels.remove).toHaveBeenCalledWith({ rawIndex: 0, model: 'val-model-1' }),
    );
    expect(await screen.findByTestId('custom-models-empty')).toBeInTheDocument();
    expect(screen.getByTestId('custom-models-notice')).toHaveTextContent('val-byok deleted.');
  });

  it('shows the daemon error and keeps the row when deleting fails', async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async () => {
      throw new Error('The daemon could not remove it.');
    });
    setup([SEEDED], { remove } as unknown as Partial<Api>);
    await user.click(await screen.findByTestId('custom-model-delete-val-model-1'));
    await user.click(screen.getByTestId('custom-model-delete-dialog-confirm'));
    expect(await screen.findByTestId('custom-models-action-error')).toHaveTextContent(
      'The daemon could not remove it.',
    );
    expect(screen.getByTestId('custom-model-row-val-model-1')).toBeInTheDocument();
  });
});
