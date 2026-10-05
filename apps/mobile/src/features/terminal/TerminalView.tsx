import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';
import { getTerminalManager } from './terminalRegistry';
import type { TerminalEntry } from './TerminalManager';

const RESIZE_DEBOUNCE_MS = 120;

interface TerminalViewProps {
  sessionId: string;
  cwd: string;
}

export function TerminalView({ sessionId, cwd }: TerminalViewProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((s) => s.connection);
  const manager = connection ? getTerminalManager(connection) : null;
  const hostRef = useRef<HTMLDivElement>(null);

  useSyncExternalStore(
    manager ? manager.subscribe : noopSubscribe,
    manager ? manager.getVersion : zero,
  );
  const snapshot = manager?.getSession(sessionId);
  const entries = snapshot?.entries ?? [];
  const active = entries.find((e) => e.id === snapshot?.activeId);
  const link = manager?.linkStatus() ?? 'idle';

  useEffect(() => {
    if (!manager || !cwd) return;
    void manager.attach(sessionId, cwd, hostRef.current);
  }, [manager, sessionId, cwd]);

  // Only the selected terminal is attached to the DOM; the others keep
  // capturing output in their detached emulators.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !manager) return;
    const element = active?.emulator.element;
    if (!element) {
      host.replaceChildren();
      return;
    }
    if (element.parentElement !== host || host.childElementCount !== 1) {
      host.replaceChildren(element);
    }
    const id = active!.id;
    if (manager.fitAndSync(sessionId, id)) return;
    // The container had no size yet (first paint, hidden tab): keep trying briefly.
    let tries = 0;
    const retry = setInterval(() => {
      if (manager.fitAndSync(sessionId, id) || ++tries >= 20) clearInterval(retry);
    }, 150);
    return () => clearInterval(retry);
  }, [manager, sessionId, active]);

  const activeId = active?.id;
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !manager || !activeId) return;
    const id = activeId;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => manager.fitAndSync(sessionId, id), RESIZE_DEBOUNCE_MS);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(host);
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (timer) clearTimeout(timer);
    };
  }, [manager, sessionId, activeId]);

  const openNew = useCallback(() => {
    if (!manager) return;
    void manager.create(sessionId, cwd, hostRef.current);
  }, [manager, sessionId, cwd]);

  const select = (entry: TerminalEntry) => {
    manager?.select(sessionId, entry.id);
    entry.emulator.focus();
  };

  const tabLabel = (entry: TerminalEntry) => {
    const base = t('terminal.tab', { n: entry.label });
    return entry.status === 'exited'
      ? `${base} Â· ${t('terminal.exitedSuffix', { code: entry.exitCode ?? '?' })}`
      : base;
  };

  const empty = !!snapshot && !snapshot.loading && !snapshot.error && entries.length === 0;

  return (
    <div className="terminal-view" data-testid="terminal-view">
      <div className="terminal-bar">
        <div className="terminal-tabs" role="tablist" aria-label={t('terminal.tabsLabel')}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`terminal-tab${entry.id === active?.id ? ' terminal-tab--active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={entry.id === active?.id}
                className="terminal-tab__select"
                data-testid={`terminal-tab-${entry.id}`}
                data-status={entry.status}
                onClick={() => select(entry)}
              >
                {tabLabel(entry)}
              </button>
              <button
                type="button"
                className="terminal-tab__close"
                data-testid={`terminal-close-${entry.id}`}
                aria-label={t('terminal.close', { n: entry.label })}
                title={t('terminal.close', { n: entry.label })}
                onClick={() => void manager?.close(sessionId, entry.id)}
              >
                <CloseIcon width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm terminal-new"
          data-testid="terminal-new"
          aria-label={t('terminal.new')}
          title={t('terminal.new')}
          disabled={!manager}
          onClick={openNew}
        >
          +
        </button>
      </div>

      {link === 'reconnecting' || link === 'closed' ? (
        <div
          className="terminal-banner terminal-banner--warn"
          data-testid="terminal-link-banner"
          role="status"
        >
          {t('terminal.linkLost')}
        </div>
      ) : null}

      {active?.status === 'exited' ? (
        <div className="terminal-banner" data-testid="terminal-exited" role="status">
          <span>{t('terminal.exitedBanner', { code: active.exitCode ?? '?' })}</span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid="terminal-restart"
            onClick={() => void manager?.restart(sessionId, active.id, hostRef.current)}
          >
            {t('terminal.restart')}
          </button>
        </div>
      ) : null}

      <div className="terminal-stage">
        <div
          ref={hostRef}
          className="terminal-host"
          data-testid="terminal-host"
          role="group"
          aria-label={active ? t('terminal.area', { n: active.label }) : t('terminal.tabsLabel')}
          data-terminal-id={active?.id}
          onClick={() => active?.emulator.focus()}
        />
        {snapshot?.loading ? (
          <div className="terminal-overlay" data-testid="terminal-loading">
            <p>{t('terminal.loading')}</p>
          </div>
        ) : null}
        {snapshot?.error ? (
          <div className="terminal-overlay" data-testid="terminal-error" role="alert">
            <p className="terminal-overlay__title">{t('terminal.errorTitle')}</p>
            <p>{snapshot.error}</p>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="terminal-retry"
              onClick={() => void manager?.retry(sessionId, cwd, hostRef.current)}
            >
              {t('terminal.retry')}
            </button>
          </div>
        ) : null}
        {empty ? (
          <div className="terminal-overlay" data-testid="terminal-empty">
            <p className="terminal-overlay__title">{t('terminal.emptyTitle')}</p>
            <p>{t('terminal.emptyMessage')}</p>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="terminal-empty-new"
              onClick={openNew}
            >
              {t('terminal.new')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const noopSubscribe = () => () => undefined;
const zero = () => 0;
