import { describe, expect, it } from 'vitest';
import en from './en.json';
import ro from './ro.json';

type Bundle = Record<string, unknown>;

function flatten(bundle: Bundle, prefix = ''): Array<[string, string]> {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? [[path, value] as [string, string]]
      : flatten(value as Bundle, path);
  });
}

// Romanian has plural categories English lacks (0 and 2..19 select "few").
const LOCALE_PLURAL_SUFFIX = /_(few|many)$/;

describe('i18n bundles', () => {
  it('en and ro expose exactly the same keys apart from locale-specific plural forms (mission directive)', () => {
    const enKeys = flatten(en).map(([key]) => key);
    const roKeys = flatten(ro).map(([key]) => key);
    expect(roKeys.filter((key) => !LOCALE_PLURAL_SUFFIX.test(key)).sort()).toEqual(
      [...enKeys].sort(),
    );
  });

  it('every locale-specific plural form has an _other companion and matching placeholders', () => {
    const roEntries = new Map(flatten(ro));
    const enEntries = new Map(flatten(en));
    const extras = [...roEntries.keys()].filter((key) => LOCALE_PLURAL_SUFFIX.test(key));
    expect(extras.length).toBeGreaterThan(0);
    for (const key of extras) {
      const otherKey = key.replace(LOCALE_PLURAL_SUFFIX, '_other');
      expect(enEntries.has(otherKey), `en lacks ${otherKey}`).toBe(true);
      expect(roEntries.has(otherKey), `ro lacks ${otherKey}`).toBe(true);
      expect(roEntries.get(key)).toContain('{{count}}');
    }
  });

  it('no localized string is empty', () => {
    for (const [name, bundle] of [
      ['en', en],
      ['ro', ro],
    ] as const) {
      for (const [key, value] of flatten(bundle)) {
        expect(value.trim(), `${name}:${key} is empty`).not.toBe('');
      }
    }
  });
});
