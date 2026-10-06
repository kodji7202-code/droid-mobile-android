import type { ReactNode } from 'react';

interface ExtensionListProps {
  testId: string;
  label: string;
  /** Rendered inside the container instead of rows once the section has loaded with nothing to list. */
  empty?: { testId: string; content: ReactNode } | null;
  children?: ReactNode;
}

/**
 * The list container of an Extensions section. It stays in the DOM whenever the
 * section has loaded, so an empty section still exposes its list with the empty
 * state inside.
 */
export function ExtensionList({ testId, label, empty = null, children }: ExtensionListProps) {
  return (
    <ul className="mcp-list" data-testid={testId} aria-label={label}>
      {empty ? (
        <li role="none" data-testid={empty.testId}>
          {empty.content}
        </li>
      ) : (
        children
      )}
    </ul>
  );
}
