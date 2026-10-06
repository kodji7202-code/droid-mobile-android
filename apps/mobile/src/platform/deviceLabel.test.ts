import { describe, expect, it } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it('prefers the high-entropy client hint model', async () => {
    const label = await deviceLabel({
      userAgentData: { getHighEntropyValues: () => Promise.resolve({ model: 'SM-S931B' }) },
      userAgent: 'Mozilla/5.0 (Linux; Android 16; K) Chrome/140',
    });
    expect(label).toBe('SM-S931B');
  });

  it('reads the model from an unreduced user agent', async () => {
    expect(
      await deviceLabel({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007) Chrome/120',
      }),
    ).toBe('Pixel 8');
  });

  it('falls back when the model is hidden or missing', async () => {
    expect(await deviceLabel({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/120' })).toBe(
      'Android device',
    );
    expect(
      await deviceLabel({
        userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('blocked')) },
      }),
    ).toBe('Android device');
    expect(await deviceLabel({})).toBe('Android device');
  });

  it('never exceeds the bridge limit of 64 characters', async () => {
    const label = await deviceLabel({
      userAgentData: { getHighEntropyValues: () => Promise.resolve({ model: 'M'.repeat(200) }) },
    });
    expect(label).toHaveLength(64);
  });
});
