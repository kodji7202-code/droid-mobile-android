import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');

function palette(selector: string): Record<string, string> {
  const block = css.split(selector)[1]?.split('}')[0] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES = {
  light: palette(":root[data-theme='light']"),
  dark: palette(":root[data-theme='dark']"),
};

const SURFACES = ['bg', 'surface', 'surface-variant'];
const TEXT_ON_SURFACES = ['fg', 'fg-muted', 'accent', 'success', 'warning', 'danger'];

describe.each(Object.entries(THEMES))('%s palette contrast (WCAG AA)', (_name, colors) => {
  it('defines every token the checks rely on', () => {
    for (const token of [...SURFACES, ...TEXT_ON_SURFACES, 'accent-fg']) {
      expect(colors[token], token).toBeDefined();
    }
  });

  it.each(TEXT_ON_SURFACES.flatMap((text) => SURFACES.map((surface) => [text, surface] as const)))(
    '%s text on %s is at least 4.5:1',
    (text, surface) => {
      expect(contrast(colors[text]!, colors[surface]!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('accent-fg on accent is at least 4.5:1', () => {
    expect(contrast(colors['accent-fg']!, colors['accent']!)).toBeGreaterThanOrEqual(4.5);
  });
});
