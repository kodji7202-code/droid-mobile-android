import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';

/** Header for a settings sub-page: back control + title. */
export function SettingsSubHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="sub-header">
      <button
        type="button"
        className="btn btn--ghost sub-header__back"
        data-testid="settings-back"
        aria-label={t('common.back')}
        onClick={() => navigate('/settings')}
      >
        <BackIcon />
      </button>
      <h2 className="sub-header__title">{title}</h2>
    </div>
  );
}
