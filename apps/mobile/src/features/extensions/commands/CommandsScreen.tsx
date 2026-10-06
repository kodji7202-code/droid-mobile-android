import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionList } from '../ExtensionList';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { useProjectFolder } from '../skills/useSkills';
import { CommandRow } from './CommandRow';
import { useCommands } from './useCommands';

/** Extensions > Commands: the custom slash commands the daemon finds for the open project. */
export function CommandsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const projectFolder = useProjectFolder();
  const { state, retry } = useCommands(connection, projectFolder);
  const list = state.status === 'ready' ? state.commands : [];

  return (
    <section
      className="screen"
      data-testid="commands-screen"
      aria-label={t('extensions.commands.title')}
    >
      <ExtensionsSubHeader title={t('extensions.commands.title')} backTo="/extensions" />
      <p className="field__description" data-testid="commands-scope">
        {projectFolder
          ? t('commands.scope.project', { folder: projectFolder })
          : t('commands.scope.none')}
      </p>
      {state.status === 'loading' ? (
        <div role="status" data-testid="commands-loading" aria-label={t('commands.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="commands-error">
          <ErrorState
            title={t('commands.loadFailedTitle')}
            message={t('commands.loadFailed')}
            onRetry={retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <ExtensionList
          testId="commands-list"
          label={t('extensions.commands.title')}
          empty={
            list.length === 0
              ? {
                  testId: 'commands-empty',
                  content: (
                    <EmptyState
                      title={t('commands.empty.title')}
                      message={t('commands.empty.message')}
                    />
                  ),
                }
              : null
          }
        >
          {list.map((command) => (
            <CommandRow key={command.name} command={command} />
          ))}
        </ExtensionList>
      ) : null}
    </section>
  );
}
