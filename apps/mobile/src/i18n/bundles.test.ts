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

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*-?\s*([\w.]+)[^}]*\}\}/g)].map((match) => match[1]!).sort();
}

// A "?" is legitimate only as sentence punctuation. These shapes are what a lossy
// encoding round trip produces: next to a letter or placeholder on its right, at a
// word start, doubled, or glued to following punctuation.
const SUSPICIOUS_QUESTION_MARK = [
  /\?(?=[\p{L}\p{N}])/u,
  /\?(?=\{\{)/,
  /(?:^|[\s„“"'(])\?/,
  /\?\?/,
  /[\p{L}\p{N}}]\?(?![\s"”»')]|$)/u,
];

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

  it('every key has the same {{placeholder}} set in en and ro', () => {
    const enEntries = new Map(flatten(en));
    for (const [key, value] of flatten(ro)) {
      // Locale-only plural forms (_few/_many) are compared with English _other.
      const enKey = key.replace(LOCALE_PLURAL_SUFFIX, '_other');
      const enValue = enEntries.get(enKey);
      if (enValue === undefined) continue;
      expect(placeholders(value), `placeholders of ${key}`).toEqual(placeholders(enValue));
    }
  });

  it('no value contains U+FFFD or a "?" standing in for a lost character', () => {
    for (const [name, bundle] of [
      ['en', en],
      ['ro', ro],
    ] as const) {
      for (const [key, value] of flatten(bundle)) {
        expect(value, `${name}:${key} contains U+FFFD`).not.toContain('\uFFFD');
        for (const pattern of SUSPICIOUS_QUESTION_MARK) {
          expect(value, `${name}:${key} has a suspicious "?" (${pattern})`).not.toMatch(pattern);
        }
      }
    }
  });

  it('the "?" detector flags lossy-encoding damage and accepts real questions', () => {
    const flagged = (text: string) =>
      SUSPICIOUS_QUESTION_MARK.some((pattern) => pattern.test(text));
    for (const damaged of [
      'Elimini ?{{label}}? ?i cheia API stocat? de pe acest dispozitiv?',
      'Nicio conexiune activ?.',
      '?tergi aceast? conexiune?',
      'Se salveaz??',
    ]) {
      expect(flagged(damaged), damaged).toBe(true);
    }
    for (const fine of [
      'Elimini „{{label}}” și cheia API stocată de pe acest dispozitiv?',
      'Instalezi {{name}}?',
      'Ștergi {{name}}? Nu se poate anula.',
    ]) {
      expect(flagged(fine), fine).toBe(false);
    }
  });

  it('ro uses a "?" only where the matching en string does', () => {
    const enEntries = new Map(flatten(en));
    const questionMarks = (text: string) => (text.match(/\?/g) ?? []).length;
    for (const [key, value] of flatten(ro)) {
      const enValue = enEntries.get(key.replace(LOCALE_PLURAL_SUFFIX, '_other'));
      if (enValue === undefined) continue;
      expect(questionMarks(value), `question marks in ro:${key}`).toBe(questionMarks(enValue));
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
