import { describe, expect, it } from 'vitest';
import { filterCommands, insertCommand, slashQuery } from './slashCommands';

const commands = [
  { name: 'val-hello', description: 'Validation hello command' },
  { name: 'review', description: 'Review the diff', argumentHint: '[branch]' },
  { name: 'deploy-val', description: 'Deploy' },
];

describe('slashQuery', () => {
  it('is null unless the draft is a single slash token', () => {
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery('hello /val')).toBeNull();
    expect(slashQuery('/val-hello ')).toBeNull();
    expect(slashQuery('/val-hello topic')).toBeNull();
    expect(slashQuery('/a\nb')).toBeNull();
  });

  it('returns the text after the slash', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/val')).toBe('val');
    expect(slashQuery('/Val-Hello')).toBe('Val-Hello');
  });
});

describe('filterCommands', () => {
  it('keeps every command for an empty query, in the daemon order', () => {
    expect(filterCommands(commands, '').map((command) => command.name)).toEqual([
      'val-hello',
      'review',
      'deploy-val',
    ]);
  });

  it('puts prefix matches before other matches and ignores case', () => {
    expect(filterCommands(commands, 'VAL').map((command) => command.name)).toEqual([
      'val-hello',
      'deploy-val',
    ]);
  });

  it('returns nothing when no name matches', () => {
    expect(filterCommands(commands, 'zzzzqq')).toEqual([]);
  });
});

describe('insertCommand', () => {
  it('replaces the draft with the command and a trailing space', () => {
    expect(insertCommand('val-hello')).toBe('/val-hello ');
  });
});
