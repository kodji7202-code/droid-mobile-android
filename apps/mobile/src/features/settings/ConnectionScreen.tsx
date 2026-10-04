import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSubHeader } from './SettingsSubHeader';
import { ConnectionForm } from './ConnectionForm';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useConnectionStore, MissingKeyError } from '../../stores/connection';
import { useLockStore } from '../../stores/lock';
import { useAuthenticate } from '../lock/useAuthenticate';
import { isDebugBuild } from '../../platform/buildFlavor';
import type { SavedConnection } from '../../platform/savedConnections';
import { isCleartextUrl } from '../connect/validation';
import { messageKeyFor } from '../connect/errors';

type Panel = { kind: 'add' } | { kind: 'edit'; id: string } | null;

function transportOf(url: string): 'ws' | 'wss' {
  return /^\s*wss:/i.test(url) ? 'wss' : 'ws';
}

/**
 * Settings > Connection: the active connection (never its key), the saved
 * connections with exactly one active, and the add / switch / edit / forget
 * flows (VAL-SET-002..005, VAL-ONBOARD-025..027).
 */
export function ConnectionScreen() {
  const { t } = useTranslation();
  const status = useConnectionStore((state) => state.status);
  const saved = useConnectionStore((state) => state.savedConnections);
  const activeId = useConnectionStore((state) => state.savedActiveId);
  const addConnection = useConnectionStore((state) => state.addConnection);
  const switchTo = useConnectionStore((state) => state.switchTo);
  const updateConnection = useConnectionStore((state) => state.updateConnection);
  const forget = useConnectionStore((state) => state.forget);
  const signOut = useConnectionStore((state) => state.signOut);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [forgetTarget, setForgetTarget] = useState<SavedConnection | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const lockEnabled = useLockStore((state) => state.enabled);
  const authenticate = useAuthenticate();
  const [revealed, setRevealed] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const hidden = lockEnabled && !revealed;

  const active = saved.find((entry) => entry.id === activeId) ?? null;
  const editing = panel?.kind === 'edit' ? saved.find((entry) => entry.id === panel.id) : undefined;

  const doSwitch = (id: string) => {
    setSwitchError(null);
    setSwitching(id);
    switchTo(id)
      .catch((error: unknown) => {
        setSwitchError(
          error instanceof MissingKeyError ? 'connections.errorMissingKey' : messageKeyFor(error),
        );
      })
      .finally(() => setSwitching(null));
  };

  // With the app lock on, details stay out of the DOM until a prompt succeeds.
  const withAuth = async (proceed: () => void) => {
    if (!lockEnabled || revealed) {
      proceed();
      return;
    }
    setRevealError(null);
    const outcome = await authenticate('reveal');
    if (outcome === 'success') {
      setRevealed(true);
      proceed();
    } else {
      setRevealError(outcome === 'cancelled' ? 'lock.revealCancelled' : 'lock.revealFailed');
    }
  };

  const confirmForget = () => {
    const target = forgetTarget;
    setForgetTarget(null);
    if (target) void forget(target.id);
  };

  const confirmSignOut = () => {
    setSignOutOpen(false);
    void signOut();
  };

  return (
    <section className="screen" data-testid="connection-screen">
      <SettingsSubHeader title={t('connections.title')} />

      <section aria-labelledby="connection-active-title" data-testid="connection-active">
        <h3 id="connection-active-title">{t('connections.activeTitle')}</h3>
        {active ? (
          <dl className="about-list">
            <div className="about-row">
              <dt>{t('connections.labelField')}</dt>
              <dd data-testid="connection-active-label">{active.label}</dd>
            </div>
            <div className="about-row">
              <dt>{t('connect.urlLabel')}</dt>
              <dd data-testid="connection-active-url">
                {hidden ? t('lock.hiddenUrl') : active.url}
              </dd>
            </div>
            <div className="about-row">
              <dt>{t('connections.transport')}</dt>
              <dd data-testid="connection-active-transport">{transportOf(active.url)}</dd>
            </div>
            <div className="about-row">
              <dt>{t('connections.status')}</dt>
              <dd data-testid="connection-active-status" data-status={status}>
                {t(`connection.status.${status}`)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="screen__description">{t('connections.noneActive')}</p>
        )}
        {active && isDebugBuild() && isCleartextUrl(active.url) ? (
          <p className="connect-banner" data-testid="connect-insecure-banner" role="status">
            {t('connect.insecureBanner')}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="connection-list-title">
        <h3 id="connection-list-title">{t('connections.listTitle')}</h3>
        {revealError ? (
          <p className="field__error" data-testid="connection-reveal-error" role="alert">
            {t(revealError)}
          </p>
        ) : null}
        {switchError ? (
          <p className="field__error" data-testid="connection-switch-error" role="alert">
            {t(switchError)}
          </p>
        ) : null}
        <ul className="settings-list" data-testid="connection-list">
          {saved.map((entry) => {
            const isActive = entry.id === activeId;
            return (
              <li
                key={entry.id}
                className="connection-item"
                data-testid={`connection-item-${entry.id}`}
                data-active={isActive}
              >
                <div className="connection-item__text">
                  <strong>{entry.label}</strong>
                  <span className="field__description">
                    {hidden ? t('lock.hiddenUrl') : entry.url}
                  </span>
                  {isActive ? (
                    <span
                      className="connection-item__marker"
                      data-testid={`connection-active-marker-${entry.id}`}
                    >
                      {t('connections.activeMarker')}
                    </span>
                  ) : null}
                </div>
                <div className="connection-item__actions">
                  {isActive ? null : (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      data-testid={`connection-switch-${entry.id}`}
                      disabled={switching !== null}
                      onClick={() => doSwitch(entry.id)}
                    >
                      {t('connections.switch')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid={`connection-edit-${entry.id}`}
                    onClick={() => void withAuth(() => setPanel({ kind: 'edit', id: entry.id }))}
                  >
                    {t('connections.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid={`connection-forget-${entry.id}`}
                    onClick={() => void withAuth(() => setForgetTarget(entry))}
                  >
                    {t('connections.forget')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {panel === null ? (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="connection-add"
            onClick={() => setPanel({ kind: 'add' })}
          >
            {t('connections.add')}
          </button>
        ) : null}
        {saved.length > 0 || active ? (
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="connection-sign-out"
            onClick={() => void withAuth(() => setSignOutOpen(true))}
          >
            {t('connections.signOut')}
          </button>
        ) : null}
      </section>

      {panel?.kind === 'add' ? (
        <ConnectionForm
          key="add"
          mode="add"
          onCancel={() => setPanel(null)}
          onSubmit={async (values) => {
            await addConnection(values);
            setPanel(null);
          }}
        />
      ) : null}
      {editing ? (
        <ConnectionForm
          key={editing.id}
          mode="edit"
          initial={{ label: editing.label, url: editing.url }}
          onCancel={() => setPanel(null)}
          onSubmit={async (values) => {
            await updateConnection(editing.id, {
              label: values.label,
              url: values.url,
              apiKey: values.apiKey || undefined,
            });
            setPanel(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={signOutOpen}
        testId="connection-sign-out-dialog"
        title={t('connections.signOutTitle')}
        message={t('connections.signOutMessage')}
        confirmLabel={t('connections.signOutConfirm')}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutOpen(false)}
      />
      <ConfirmDialog
        open={forgetTarget !== null}
        testId="connection-forget-dialog"
        title={t('connections.forgetTitle')}
        message={t('connections.forgetMessage', { label: forgetTarget?.label ?? '' })}
        confirmLabel={t('connections.forgetConfirm')}
        onConfirm={confirmForget}
        onCancel={() => setForgetTarget(null)}
      />
    </section>
  );
}
