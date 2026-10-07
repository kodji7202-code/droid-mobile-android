import { memo, useEffect, useState, type ComponentProps } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type RehypePlugin = NonNullable<ComponentProps<typeof Markdown>['rehypePlugins']>[number];

const SAFE_LINK = /^(https?:|mailto:)/i;

let highlighter: Promise<RehypePlugin> | undefined;

/** The highlighter and its grammars are a separate chunk; the first code block pays for it. */
function loadHighlighter(): Promise<RehypePlugin> {
  highlighter ??= import('rehype-highlight').then((module) => module.default as RehypePlugin);
  return highlighter;
}

const components: Components = {
  a({ href, children }) {
    if (href === undefined || !SAFE_LINK.test(href)) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Remote images would let a message ping arbitrary hosts; show the alt text instead.
  img({ alt }) {
    return alt ? <span>{alt}</span> : null;
  },
  table({ children }) {
    return (
      <div className="markdown__table-scroll">
        <table>{children}</table>
      </div>
    );
  },
};

const REMARK_PLUGINS = [remarkGfm];

/**
 * Renders untrusted assistant text. Raw HTML in the source is never turned into
 * elements (react-markdown builds React nodes from the markdown tree and no
 * raw-HTML plugin is installed), and only http(s) and mailto links keep an href.
 */
export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  const hasCode = text.includes('```') || text.includes('~~~');
  const [highlight, setHighlight] = useState<RehypePlugin>();

  useEffect(() => {
    if (!hasCode) return;
    let cancelled = false;
    void loadHighlighter().then((plugin) => {
      if (!cancelled) setHighlight(() => plugin);
    });
    return () => {
      cancelled = true;
    };
  }, [hasCode]);

  return (
    <div className="markdown" data-testid="markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={highlight ? [highlight] : []}
        components={components}
        urlTransform={(url) => (SAFE_LINK.test(url) ? url : '')}
      >
        {text}
      </Markdown>
    </div>
  );
});
