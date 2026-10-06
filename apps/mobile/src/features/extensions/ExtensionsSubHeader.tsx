import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';

interface ExtensionsSubHeaderProps {
  title: string;
  backTo: string;
  /** Primary actions shown at the trailing edge. */
  actions?: ReactNode;
}

/** Header of an Extensions section: back control, title and section actions. */
export function ExtensionsSubHeader({ title, backTo, actions }: ExtensionsSubHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="sub-header">
      <button
        type="button"
        className="btn btn--ghost sub-header__back"
        data-testid="extensions-back"
        aria-label={t('common.back')}
        onClick={() => navigate(backTo)}
      >
        <BackIcon />
      </button>
      <h2 className="sub-header__title">{title}</h2>
      {actions ? <div className="sub-header__actions">{actions}</div> : null}
    </div>
  );
}
