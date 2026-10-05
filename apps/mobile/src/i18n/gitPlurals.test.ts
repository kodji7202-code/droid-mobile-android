import { afterEach, describe, expect, it } from 'vitest';
import i18next from './init';

const ROMANIAN_COUNTERS: Array<[string, Record<number, string>]> = [
  [
    'git.branches.changedFiles',
    {
      0: '0 fișiere modificate',
      1: '1 fișier modificat',
      2: '2 fișiere modificate',
      20: '20 de fișiere modificate',
    },
  ],
  [
    'git.branches.additions',
    { 0: '0 adăugări', 1: '1 adăugare', 2: '2 adăugări', 20: '20 de adăugări' },
  ],
  [
    'git.branches.deletions',
    { 0: '0 ștergeri', 1: '1 ștergere', 2: '2 ștergeri', 20: '20 de ștergeri' },
  ],
  [
    'git.branches.untrackedFiles',
    {
      0: '0 fișiere neurmărite',
      1: '1 fișier neurmărit',
      2: '2 fișiere neurmărite',
      20: '20 de fișiere neurmărite',
    },
  ],
  [
    'git.commit.filesTitle',
    {
      0: '0 fișiere modificate vor fi comise',
      1: '1 fișier modificat va fi comis',
      2: '2 fișiere modificate vor fi comise',
      20: '20 de fișiere modificate vor fi comise',
    },
  ],
  [
    'git.push.pending',
    {
      0: '0 commit-uri de trimis',
      1: '1 commit de trimis',
      2: '2 commit-uri de trimis',
      20: '20 de commit-uri de trimis',
    },
  ],
];

describe('Git counter plurals', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it.each(ROMANIAN_COUNTERS)(
    '%s renders Romanian output for counts 0, 1, 2, 20',
    async (key, expected) => {
      await i18next.changeLanguage('ro');
      for (const [count, text] of Object.entries(expected)) {
        expect(i18next.t(key, { count: Number(count) }), `${key} count=${count}`).toBe(text);
      }
    },
  );

  it.each(ROMANIAN_COUNTERS)('%s keeps English output for counts 0, 1, 2', async (key) => {
    await i18next.changeLanguage('en');
    for (const count of [0, 1, 2]) {
      expect(i18next.t(key, { count })).toMatch(new RegExp(`^${count} [a-z]`));
    }
    expect(i18next.t(key, { count: 0 })).toMatch(/s( |$)/);
  });
});
