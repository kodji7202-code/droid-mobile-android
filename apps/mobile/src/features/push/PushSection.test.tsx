import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../i18n/init';
import en from '../../i18n/en.json';
import ro from '../../i18n/ro.json';
import { BridgeError } from '../../platform/bridgeClient';
import { getSecureStore } from '../../platform/secureStore';
import { releasePushRegistration } from '../../stores/push';
import { AppProviders } from '../../test/render-app';
import { PENDING_BRIDGE_SECRET_ID } from '../connect/pairing';
import { PushSection } from './PushSection';

const SECRET = 'pair-secret-probe-0123456789';
const BRIDGE = 'http://10.0.2.2:3102';
const CODE = `droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101&bridge=${encodeURIComponent(BRIDGE)}&bridgeSecret=${SECRET}`;

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  scanImage: vi.fn(),
}));

vi.mock('../../platform/pushMessaging', () => ({
  pushMessaging: {
    isSupported: () => true,
    getToken: vi.fn(() => Promise.resolve('aaaa:bbbb')),
    onTokenRefresh: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../platform/deviceLabel', () => ({ deviceLabel: () => Promise.resolve('Test phone') }));
vi.mock('../../platform/buildFlavor', () => ({ isDebugBuild: () => true }));
vi.mock('../../platform/qrScanner', () => ({
  qrScanner: { scanImage: mocks.scanImage },
}));
vi.mock('../../platform/bridgeClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/bridgeClient')>()),
  bridgeClient: { register: mocks.register, unregister: mocks.unregister },
}));

function renderSection() {
  return render(
    <AppProviders>
      <PushSection />
    </AppProviders>,
  );
}

function status() {
  return screen.getByTestId('settings-push-status');
}

describe('Settings > Notifications > push section', () => {
  beforeEach(async () => {
    mocks.register.mockReset().mockResolvedValue(undefined);
    mocks.unregister.mockReset().mockResolvedValue(true);
    mocks.scanImage.mockReset();
    await releasePushRegistration();
    await getSecureStore().deleteSecret(PENDING_BRIDGE_SECRET_ID);
    window.localStorage.clear();
    await act(async () => {
      await changeAppLanguage('en');
    });
  });

  it('registers from a pasted pairing code, clears the field and keeps the secret out of the page', async () => {
    renderSection();
    expect(status()).toHaveAttribute('data-state', 'unregistered');
    const field = screen.getByTestId('settings-push-pairing');
    fireEvent.change(field, { target: { value: CODE } });

    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    expect(status()).toHaveTextContent(en.push.status.registered);
    expect(mocks.register).toHaveBeenCalledWith(
      { bridge: BRIDGE, secret: SECRET },
      expect.objectContaining({ fcmToken: 'aaaa:bbbb', label: 'Test phone' }),
    );
    expect(screen.getByTestId('settings-push-device-label')).toHaveTextContent('Test phone');
    expect(screen.getByTestId('settings-push-device-id').textContent).toMatch(/^[\w.-]{1,64}$/);
    expect(screen.getByTestId('settings-push-bridge')).toHaveTextContent(BRIDGE);
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(screen.getByTestId<HTMLInputElement>('settings-push-pairing').value).toBe('');
    expect(screen.queryByTestId('settings-push-register')).not.toBeInTheDocument();
  });

  it('shows a localized error for an invalid code and clears the field', async () => {
    renderSection();
    const field = screen.getByTestId<HTMLInputElement>('settings-push-pairing');
    fireEvent.change(field, { target: { value: `junk ${SECRET}` } });
    expect(await screen.findByTestId('settings-push-error')).toHaveTextContent(
      en.push.error.pairingInvalid,
    );
    expect(field.value).toBe('');
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('a wrong secret shows a localized error without the secret or any server text and stays unregistered', async () => {
    mocks.register.mockRejectedValue(new BridgeError('unauthorized'));
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByTestId('settings-push-bridge-url'), BRIDGE);
    await user.type(screen.getByTestId('settings-push-secret'), 'wrong-secret-value');
    await user.click(screen.getByTestId('settings-push-register'));

    const error = await screen.findByTestId('settings-push-error');
    expect(error).toHaveTextContent(en.push.error.unauthorized);
    expect(document.body.textContent).not.toContain('wrong-secret-value');
    expect(status()).toHaveAttribute('data-state', 'unregistered');
  });

  it('an unreachable bridge shows the localized message (Romanian too) and a retry can succeed', async () => {
    mocks.register.mockRejectedValueOnce(new BridgeError('unreachable'));
    await act(async () => {
      await changeAppLanguage('ro');
    });
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByTestId('settings-push-bridge-url'), BRIDGE);
    await user.type(screen.getByTestId('settings-push-secret'), SECRET);
    await user.click(screen.getByTestId('settings-push-register'));
    expect(await screen.findByTestId('settings-push-error')).toHaveTextContent(
      ro.push.error.unreachable,
    );
    expect(status()).toHaveAttribute('data-state', 'unregistered');

    await user.click(screen.getByTestId('settings-push-register'));
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    expect(screen.queryByTestId('settings-push-error')).not.toBeInTheDocument();
  });

  it('keeps the secret field masked and opted out of autofill', () => {
    renderSection();
    for (const id of [
      'settings-push-secret',
      'settings-push-pairing',
      'settings-push-bridge-url',
    ]) {
      const field = screen.getByTestId(id);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-lpignore', 'true');
    }
    expect(screen.getByTestId('settings-push-secret')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('settings-push-secret').closest('form')).toBeNull();
  });

  it('registers from an imported QR image and rejects an image without a code', async () => {
    const user = userEvent.setup();
    renderSection();
    mocks.scanImage.mockResolvedValueOnce({ status: 'none' });
    await user.click(screen.getByTestId('settings-push-scan-image'));
    expect(await screen.findByTestId('settings-push-scan-notice')).toHaveTextContent(
      en.push.scanNoQr,
    );
    expect(mocks.register).not.toHaveBeenCalled();
    expect(status()).toHaveAttribute('data-state', 'unregistered');

    mocks.scanImage.mockResolvedValueOnce({ status: 'ok', text: CODE });
    await user.click(screen.getByTestId('settings-push-scan-image'));
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    expect(screen.queryByTestId('settings-push-scan-notice')).not.toBeInTheDocument();
  });

  it('stays quiet when the picker is cancelled and reports an unreadable image', async () => {
    const user = userEvent.setup();
    renderSection();
    mocks.scanImage.mockResolvedValueOnce({ status: 'cancelled' });
    await user.click(screen.getByTestId('settings-push-scan-image'));
    await waitFor(() => expect(mocks.scanImage).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('settings-push-scan-notice')).not.toBeInTheDocument();
    mocks.scanImage.mockResolvedValueOnce({ status: 'error' });
    await user.click(screen.getByTestId('settings-push-scan-image'));
    expect(await screen.findByTestId('settings-push-scan-notice')).toHaveTextContent(
      en.push.scanFailed,
    );
  });

  it('prefills the bridge from a pending pairing and registers without retyping the secret', async () => {
    await getSecureStore().setSecret(
      PENDING_BRIDGE_SECRET_ID,
      JSON.stringify({ bridge: BRIDGE, bridgeSecret: SECRET }),
    );
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByTestId('settings-push-pending')).toBeInTheDocument();
    expect(screen.getByTestId<HTMLInputElement>('settings-push-bridge-url').value).toBe(BRIDGE);
    expect(document.body.innerHTML).not.toContain(SECRET);
    await user.click(screen.getByTestId('settings-push-register'));
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    expect(mocks.register.mock.calls[0]?.[0]).toEqual({ bridge: BRIDGE, secret: SECRET });
    expect(await getSecureStore().getSecret(PENDING_BRIDGE_SECRET_ID)).toBeNull();
  });

  it('discarding the pending pairing removes it', async () => {
    await getSecureStore().setSecret(
      PENDING_BRIDGE_SECRET_ID,
      JSON.stringify({ bridge: BRIDGE, bridgeSecret: SECRET }),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId('settings-push-discard-pending'));
    await waitFor(() =>
      expect(screen.queryByTestId('settings-push-pending')).not.toBeInTheDocument(),
    );
    expect(await getSecureStore().getSecret(PENDING_BRIDGE_SECRET_ID)).toBeNull();
  });

  it('turning push off deletes the device from the bridge and brings the form back', async () => {
    const user = userEvent.setup();
    renderSection();
    fireEvent.change(screen.getByTestId('settings-push-pairing'), { target: { value: CODE } });
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    await user.click(screen.getByTestId('settings-push-disable'));
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'unregistered'));
    expect(mocks.unregister).toHaveBeenCalledWith(
      { bridge: BRIDGE, secret: SECRET },
      expect.stringMatching(/^droid-/),
    );
    expect(screen.getByTestId('settings-push-register')).toBeInTheDocument();
  });

  it('offers a local-only turn-off when the bridge cannot be reached', async () => {
    const user = userEvent.setup();
    renderSection();
    fireEvent.change(screen.getByTestId('settings-push-pairing'), { target: { value: CODE } });
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'registered'));
    mocks.unregister.mockRejectedValueOnce(new BridgeError('unreachable'));
    await user.click(screen.getByTestId('settings-push-disable'));
    expect(await screen.findByTestId('settings-push-error')).toHaveTextContent(
      en.push.error.unregisterFailed,
    );
    expect(status()).toHaveAttribute('data-state', 'registered');
    await user.click(screen.getByTestId('settings-push-disable-local'));
    await waitFor(() => expect(status()).toHaveAttribute('data-state', 'unregistered'));
    expect(mocks.unregister).toHaveBeenCalledTimes(1);
  });
});
