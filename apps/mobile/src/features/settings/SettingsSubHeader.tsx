import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';
import { useMediaQuery } from '../../app/useMediaQuery';

/**
 * Header for a settings sub-page: back control + title. The back control is
 * omitted in the tablet master-detail layout, where the list is always visible.
 * backTo is the page the control returns to (the landing list by default).
 */
export function SettingsSubHeader({
  title,
  backTo = '/settings',
}: {
  title: string;
  backTo?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 840px)');
  return (
    <div className="sub-header">
      {wide ? null : (
        <button
          type="button"
          className="btn btn--ghost sub-header__back"
          data-testid="settings-back"
          aria-label={t('common.back')}
          onClick={() => navigate(backTo)}
        >
          <BackIcon />
        </button>
      )}
      <h2 className="sub-header__title">{title}</h2>
    </div>
  );
}
