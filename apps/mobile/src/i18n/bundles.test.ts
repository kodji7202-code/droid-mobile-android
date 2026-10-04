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

describe('i18n bundles', () => {
  it('en and ro expose exactly the same keys (mission directive)', () => {
    expect(
      flatten(ro)
        .map(([key]) => key)
        .sort(),
    ).toEqual(
      flatten(en)
        .map(([key]) => key)
        .sort(),
    );
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
