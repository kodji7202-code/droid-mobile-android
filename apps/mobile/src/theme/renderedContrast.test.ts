import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');
const appCss = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

type Rgb = [number, number, number];

function palette(selector: string): Record<string, string> {
  const block = themeCss.split(selector)[1]?.split('}')[0] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
}

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(appCss);
  if (!match) throw new Error(`No rule for ${selector}`);
  return Object.fromEntries(
    [...match[1]!.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as Rgb;
}

function resolveColor(value: string, colors: Record<string, string>): Rgb {
  const token = /^var\(--([\w-]+)(?:,\s*([^)]+))?\)$/.exec(value);
  if (!token) throw new Error(`Unsupported color ${value}`);
  const hex = colors[token[1]!];
  // A token that is not defined would silently fall back; treat that as a failure.
  if (!hex) throw new Error(`--${token[1]} is not defined in the theme`);
  return rgb(hex);
}

const THEMES = {
  light: palette(":root[data-theme='light']"),
  dark: palette(":root[data-theme='dark']"),
};

describe.each(Object.entries(THEMES))('%s rendered colors', (_name, colors) => {
  it('armed terminal key text on its accent background is at least 4.5:1', () => {
    const rule = declarations('.terminal-key--active');
    const text = resolveColor(rule['color']!, colors);
    const background = resolveColor(rule['background']!, colors);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('custom-command notice role label, after opacity, is at least 4.5:1 on the page', () => {
    const notice = declarations('.session-message--notice');
    const base = declarations('.session-message__role');
    const override = declarations('.session-message--notice .session-message__role');
    const opacity = Number(override['opacity'] ?? base['opacity'] ?? '1');
    const text = resolveColor(notice['color']!, colors);
    for (const surface of ['bg', 'surface']) {
      const page = rgb(colors[`color-${surface}`]!);
      expect(contrast(blend(text, page, opacity), page), surface).toBeGreaterThanOrEqual(4.5);
    }
  });
});
