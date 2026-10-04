import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  message?: string;
  /** Optional call to action (e.g. a create button). */
  action?: ReactNode;
}

/** Centered placeholder for lists/areas with nothing to show yet. */
export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <p className="empty-state__title">{title}</p>
      {message ? <p className="empty-state__message">{message}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
