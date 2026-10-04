import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '../components/ErrorState';

function BoundaryFallback({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="boundary-fallback" data-testid="error-boundary">
      <ErrorState
        title={t('shell.errorTitle')}
        message={t('shell.errorMessage')}
        onRetry={onReload}
        retryLabel={t('shell.reload')}
      />
    </div>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort error boundary around the whole app (render-phase crashes do
 * not reach the router's errorElement). The fallback is localized and offers
 * a reload; error details go to the console only (no secrets are logged).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <BoundaryFallback onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
