import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import ro from '../i18n/ro.json';

const read = (folder: string) =>
  readFileSync(
    resolve(import.meta.dirname, '../../android/app/src/main/res', folder, 'strings.xml'),
    'utf8',
  );

const names = (xml: string) =>
  Object.fromEntries(
    [...xml.matchAll(/<string name="channel_(\w+)_name">([^<]*)<\/string>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );

describe('native channel names', () => {
  it('match the English bundle in values/strings.xml', () => {
    expect(names(read('values'))).toEqual(en.notifications.channel);
  });

  it('match the Romanian bundle in values-ro/strings.xml', () => {
    expect(names(read('values-ro'))).toEqual(ro.notifications.channel);
  });
});
