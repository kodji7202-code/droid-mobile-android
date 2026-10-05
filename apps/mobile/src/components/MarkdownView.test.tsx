import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MarkdownView } from './MarkdownView';

declare global {
  interface Window {
    __pwn?: number;
  }
}

describe('MarkdownView structure', () => {
  it('renders headings, lists and tables as elements without raw markers', () => {
    const text = [
      '# Title',
      '',
      '## Sub',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    const { container } = render(<MarkdownView text={text} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('table thead tr')).toHaveLength(1);
    expect(container.querySelectorAll('table thead th')).toHaveLength(2);
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(1);
    expect(container.querySelectorAll('table tbody td')).toHaveLength(2);
    expect(container.textContent).not.toContain('|---|');
    expect(container.textContent).not.toContain('#');
  });

  it('opens http links in a new context with noopener noreferrer', () => {
    render(<MarkdownView text="[docs](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect((link as HTMLAnchorElement).href).toBe('https://example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(screen.queryByText(/\[docs\]/)).toBeNull();
  });

  it('highlights fenced code lazily with several token spans', async () => {
    const { container } = render(
      <MarkdownView text={'```typescript\nconst x: number = 1; console.log(x);\n```'} />,
    );
    expect(container.querySelector('pre > code')).not.toBeNull();
    await waitFor(() =>
      expect(container.querySelectorAll('pre > code span[class^="hljs-"]').length).toBeGreaterThan(
        1,
      ),
    );
    expect(container.textContent).not.toContain('```');
  });
});

describe('MarkdownView untrusted markup corpus', () => {
  const corpus = [
    '<script>window.__pwn=1</script>',
    '<img src=x onerror="window.__pwn=1">',
    '[x](javascript:window.__pwn=1)',
    '[x](JaVaScRiPt:window.__pwn=1)',
    '[x](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd249MTwvc2NyaXB0Pg==)',
    '<a href="javascript:window.__pwn=1">y</a>',
    '<iframe src="javascript:window.__pwn=1"></iframe>',
    '<svg onload="window.__pwn=1"></svg>',
    '![x](javascript:window.__pwn=1)',
    '<div onclick="window.__pwn=1">z</div>',
  ];

  it.each(corpus)('is inert: %s', async (markup) => {
    window.__pwn = undefined;
    const { container } = render(<MarkdownView text={markup} />);
    const user = userEvent.setup();
    for (const element of Array.from(container.querySelectorAll('*'))) {
      await user.click(element);
    }
    expect(window.__pwn).toBeUndefined();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror], [onclick], [onload]')).toBeNull();
    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/^\s*(javascript|data):/i);
    }
  });

  it('renders a javascript: link without any href', () => {
    const { container } = render(<MarkdownView text="[x](javascript:window.__pwn=1)" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.textContent).toContain('x');
  });
});
