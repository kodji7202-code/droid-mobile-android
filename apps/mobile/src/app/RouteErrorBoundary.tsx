import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

/** Localized screen shown for unknown routes. */
export function NotFoundScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="route-error" data-testid="route-not-found">
      <EmptyState title={t('route.notFoundTitle')} message={t('route.notFoundMessage')} />
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => navigate('/sessions', { replace: true })}
      >
        {t('route.goHome')}
      </button>
    </div>
  );
}

/**
 * Router-level error element: localized not-found and error states for
 * routing/render failures inside a route. Render crashes that escape every
 * route are caught by the outer ErrorBoundary instead.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundScreen />;
  }

  console.error('[app] route error', error);
  return (
    <div className="route-error" data-testid="route-error">
      <ErrorState
        title={t('shell.errorTitle')}
        message={t('shell.errorMessage')}
        onRetry={() => navigate('/sessions', { replace: true })}
        retryLabel={t('route.goHome')}
      />
    </div>
  );
}
