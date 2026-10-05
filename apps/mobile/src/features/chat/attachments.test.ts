import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS, classifyFile, readAttachment, toStreamOptions } from './attachments';

const file = (name: string, type: string, content = 'x') => new File([content], name, { type });

describe('classifyFile', () => {
  it.each([
    ['red.png', 'image/png', 'image'],
    ['green.jpg', 'image/jpeg', 'image'],
    ['blue.gif', 'image/gif', 'image'],
    ['yellow.webp', 'image/webp', 'image'],
    ['token.pdf', 'application/pdf', 'pdf'],
    ['token.txt', 'text/plain', 'text'],
    ['notes.md', '', 'text'],
  ])('accepts %s (%s) as %s', (name, type, kind) => {
    expect(classifyFile({ name, type })?.kind).toBe(kind);
  });

  it.each([
    ['setup.exe', 'application/x-msdownload'],
    ['archive.zip', 'application/zip'],
    ['clip.mp4', 'video/mp4'],
    ['photo.bmp', 'image/bmp'],
    ['fake.png', 'application/zip'],
  ])('rejects %s (%s)', (name, type) => {
    expect(classifyFile({ name, type })).toBeUndefined();
  });
});

describe('readAttachment', () => {
  it('reads an image as base64 without the data-URL prefix', async () => {
    const result = await readAttachment(file('a.png', 'image/png', 'abc'), 0);
    expect(result).toEqual({
      attachment: { kind: 'image', mediaType: 'image/png', data: btoa('abc') },
    });
  });

  it('re-encodes GIF and WebP as PNG because the daemon cannot compress them', async () => {
    const toPng = async () => 'data:image/png;base64,UE5H';
    for (const [name, type] of [
      ['b.gif', 'image/gif'],
      ['y.webp', 'image/webp'],
    ]) {
      expect(await readAttachment(file(name!, type!), 0, toPng)).toEqual({
        attachment: { kind: 'image', mediaType: 'image/png', data: 'UE5H' },
      });
    }
  });

  it('reports an undecodable image as unreadable', async () => {
    const toPng = async () => {
      throw new Error('decode');
    };
    expect(await readAttachment(file('b.gif', 'image/gif'), 0, toPng)).toEqual({
      rejection: { reason: 'read', name: 'b.gif' },
    });
  });

  it('reads text files as text and PDFs as base64', async () => {
    expect(await readAttachment(file('token.txt', 'text/plain', 'ZEBRA-4172'), 0)).toEqual({
      attachment: { kind: 'file', name: 'token.txt', mediaType: 'text/plain', data: 'ZEBRA-4172' },
    });
    expect(await readAttachment(file('t.pdf', 'application/pdf', 'pdf'), 0)).toEqual({
      attachment: {
        kind: 'file',
        name: 't.pdf',
        mediaType: 'application/pdf',
        data: btoa('pdf'),
      },
    });
  });

  it('rejects an unsupported type naming it, and oversized or surplus files', async () => {
    expect(await readAttachment(file('clip.mp4', 'video/mp4'), 0)).toEqual({
      rejection: { reason: 'type', name: 'clip.mp4', type: 'video/mp4' },
    });
    const big = { name: 'big.png', type: 'image/png', size: 6 * 1024 * 1024 } as File;
    expect(await readAttachment(big, 0)).toEqual({
      rejection: { reason: 'size', name: 'big.png', limitMb: 5 },
    });
    expect(await readAttachment(file('a.png', 'image/png'), MAX_ATTACHMENTS)).toEqual({
      rejection: { reason: 'count', name: 'a.png', limit: MAX_ATTACHMENTS },
    });
  });
});

describe('toStreamOptions', () => {
  it('splits images and documents into the daemon options and omits empty groups', () => {
    expect(toStreamOptions([])).toEqual({});
    expect(
      toStreamOptions([
        { kind: 'image', mediaType: 'image/gif', data: 'AA' },
        { kind: 'file', name: 't.pdf', mediaType: 'application/pdf', data: 'BB' },
        { kind: 'file', name: 't.txt', mediaType: 'text/plain', data: 'CC' },
      ]),
    ).toEqual({
      images: [{ type: 'base64', data: 'AA', mediaType: 'image/gif' }],
      files: [
        { type: 'base64', data: 'BB', mediaType: 'application/pdf', name: 't.pdf' },
        { type: 'text', data: 'CC', mediaType: 'text/plain', name: 't.txt' },
      ],
    });
  });
});
