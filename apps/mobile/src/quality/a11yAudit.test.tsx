import axe from 'axe-core';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { i18nReady } from '../i18n/init';
import { renderAppAt } from '../test/render-app';
import { stubMatchMedia } from '../test/match-media';

const ROUTES = [
  '/connect',
  '/sessions',
  '/sessions/s1',
  '/workspace',
  '/extensions',
  '/extensions/mcp',
  '/extensions/skills',
  '/extensions/commands',
  '/extensions/custom-models',
  '/extensions/plugins',
  '/extensions/plugins/marketplaces',
  '/extensions/automations',
  '/settings',
  '/settings/connection',
  '/settings/security',
  '/settings/notifications',
  '/settings/notifications/battery',
  '/settings/appearance',
  '/settings/language',
  '/settings/defaults',
  '/settings/about',
  '/does-not-exist',
];

const NAME_RULES = [
  'button-name',
  'link-name',
  'label',
  'select-name',
  'input-button-name',
  'aria-input-field-name',
  'aria-toggle-field-name',
  'aria-command-name',
];

const CONTROLS = 'button, a, input, select, textarea, [role=button], [role=switch], [role=tab]';
const I18N_KEY = /^[a-z][A-Za-z]*(\.[A-Za-z_]+)+$/;

/** Every method resolves never, so screens stay in their loading state instead of crashing. */
function pendingConnection(): DaemonConnection {
  const node: object = new Proxy(function pending() {}, {
    get: (_target, key) => (key === 'then' ? undefined : node),
    apply: () => new Promise(() => undefined),
  });
  return node as DaemonConnection;
}

async function audit(path: string) {
  renderAppAt(path, { connected: path !== '/connect', connection: pendingConnection() });
  expect(screen.queryByTestId('route-error')).not.toBeInTheDocument();
  const result = await axe.run(document.body, { runOnly: { type: 'rule', values: NAME_RULES } });
  expect(screen.queryByTestId('route-error')).not.toBeInTheDocument();
  const rawNames = [...document.querySelectorAll<HTMLElement>(CONTROLS)]
    .map((element) => ({
      testId: element.dataset.testid,
      name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim(),
    }))
    .filter(({ testId, name }) => name !== '' && (name === testId || I18N_KEY.test(name)));
  return { violations: result.violations.map((v) => v.id), rawNames };
}

describe.each([['en'], ['ro']])('accessible names (%s)', (language) => {
  let restore: (() => void) | undefined;
  beforeEach(async () => {
    await i18nReady;
    await act(() => i18n.changeLanguage(language));
  });
  afterEach(async () => {
    restore?.();
    restore = undefined;
    window.localStorage.clear();
    await act(() => i18n.changeLanguage('en'));
  });

  it.each(ROUTES)('every control on %s has a real name (phone layout)', async (path) => {
    const { violations, rawNames } = await audit(path);
    expect(violations).toEqual([]);
    expect(rawNames).toEqual([]);
    expect(screen.queryAllByRole('button').length).toBeGreaterThanOrEqual(0);
  });

  it.each(['/sessions', '/sessions/s1', '/settings/about'])(
    'every control on %s has a real name (tablet layout)',
    async (path) => {
      restore = stubMatchMedia(true);
      const { violations, rawNames } = await audit(path);
      expect(violations).toEqual([]);
      expect(rawNames).toEqual([]);
    },
  );
});
