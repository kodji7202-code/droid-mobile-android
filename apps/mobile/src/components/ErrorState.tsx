interface ErrorStateProps {
  title: string;
  message: string;
  /** When given, renders a retry control labelled retryLabel. */
  onRetry?: () => void;
  retryLabel?: string;
}

/** Error placeholder with an optional retry control. Messages must be pre-redacted. */
export function ErrorState({ title, message, onRetry, retryLabel }: ErrorStateProps) {
  return (
    <div className="error-state" data-testid="error-state" role="alert">
      <p className="error-state__title">{title}</p>
      <p className="error-state__message">{message}</p>
      {onRetry ? (
        <button
          type="button"
          className="btn btn--primary"
          onClick={onRetry}
          data-testid="error-state-retry"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
