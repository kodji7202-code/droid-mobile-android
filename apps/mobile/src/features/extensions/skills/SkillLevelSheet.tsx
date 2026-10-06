import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillLevel } from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';

interface SkillLevelSheetProps {
  open: boolean;
  skillName: string;
  /** Folder the project level would apply to; undefined when no project is open. */
  projectFolder: string | undefined;
  projectAvailable: boolean;
  onConfirm: (level: SkillLevel) => void;
  onClose: () => void;
}

function LevelForm({
  skillName,
  projectFolder,
  projectAvailable,
  onConfirm,
  onClose,
}: Omit<SkillLevelSheetProps, 'open'>) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<SkillLevel>('user');
  const projectOffered = projectFolder !== undefined && projectAvailable;

  return (
    <form
      className="skill-level"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(level);
      }}
    >
      <p>{t('skills.level.message', { name: skillName })}</p>
      <fieldset className="skill-level__choices">
        <legend className="field__label">{t('skills.level.legend')}</legend>
        <label className="skill-level__choice">
          <input
            type="radio"
            name="skill-level"
            value="user"
            data-testid="skill-level-user"
            checked={level === 'user'}
            onChange={() => setLevel('user')}
          />
          <span>
            <span className="skill-level__name">{t('skills.level.user')}</span>
            <span className="field__description">{t('skills.level.userHint')}</span>
          </span>
        </label>
        <label className="skill-level__choice">
          <input
            type="radio"
            name="skill-level"
            value="project"
            data-testid="skill-level-project"
            checked={level === 'project'}
            disabled={!projectOffered}
            onChange={() => setLevel('project')}
          />
          <span>
            <span className="skill-level__name">{t('skills.level.project')}</span>
            <span className="field__description" data-testid="skill-level-project-hint">
              {projectOffered
                ? t('skills.level.projectHint', { folder: projectFolder })
                : t('skills.level.projectUnavailable')}
            </span>
          </span>
        </label>
      </fieldset>
      <div className="mcp-form__actions">
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="skill-level-cancel"
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" data-testid="skill-level-confirm">
          {t('skills.level.confirm')}
        </button>
      </div>
    </form>
  );
}

/** Asks where a skill is switched off before anything is sent to the daemon. */
export function SkillLevelSheet({ open, onClose, ...rest }: SkillLevelSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('skills.level.title', { name: rest.skillName })}
      testId="skill-level-sheet"
    >
      <LevelForm onClose={onClose} {...rest} />
    </Sheet>
  );
}
