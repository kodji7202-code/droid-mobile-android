import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isMissionIdle } from '@droidmobile/daemon-client';
import type { MissionView } from '@droidmobile/daemon-client';
import { useMediaQuery } from '../../app/useMediaQuery';
import { EmptyState } from '../../components/EmptyState';
import { FeatureList } from './FeatureList';
import { MissionStateBadge } from './MissionStateBadge';
import { LastActivity, ProgressLog, WorkerList } from './WorkerList';

type Section = 'thread' | 'features' | 'workers';
const SECTIONS: Section[] = ['thread', 'features', 'workers'];

interface MissionControlProps {
  view: MissionView | undefined;
  /** The orchestrator conversation, rendered by the normal chat transcript. */
  thread: ReactNode;
  threadEmpty: boolean;
}

/**
 * Mission Control of a Mission-mode session. A phone shows one section at a time
 * behind tabs; from 840 px the sections sit side by side. Inactive tab panels stay
 * mounted (hidden) so switching never loses scroll or state.
 */
export function MissionControl({ view, thread, threadEmpty }: MissionControlProps) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 840px)');
  const [chosen, setChosen] = useState<Section | undefined>();
  const idle = isMissionIdle(view);
  const active: Section = chosen ?? (view && view.features.length > 0 ? 'features' : 'thread');
  const shown = (section: Section) => wide || active === section;

  const threadPanel = (
    <section
      className="mission-panel mission-panel--thread"
      data-testid="mission-panel-thread"
      aria-label={t('missions.thread.title')}
      id="mission-panel-thread"
      role={wide ? undefined : 'tabpanel'}
      hidden={!shown('thread')}
    >
      <h3 className="mission-panel__title">{t('missions.thread.title')}</h3>
      {threadEmpty ? (
        <p className="mission-panel__empty" data-testid="mission-thread-empty">
          {t('missions.thread.empty')}
        </p>
      ) : (
        thread
      )}
    </section>
  );

  return (
    <div className="mission-control" data-testid="missions-view">
      <header className="mission-control__header">
        <h3 className="mission-control__title">{t('missions.title')}</h3>
        {view ? <MissionStateBadge state={view.state} /> : null}
      </header>

      {idle ? (
        <>
          <div data-testid="missions-empty">
            <EmptyState title={t('missions.empty.title')} message={t('missions.empty.message')} />
          </div>
          {threadEmpty ? null : threadPanel}
        </>
      ) : (
        <>
          {wide ? null : (
            <div
              className="mission-tabs"
              role="tablist"
              aria-label={t('missions.tabs.label')}
              data-testid="mission-tabs"
            >
              {SECTIONS.map((section) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  id={`mission-tab-${section}`}
                  className="mission-tabs__tab"
                  data-testid={`mission-tab-${section}`}
                  aria-selected={active === section}
                  aria-controls={`mission-panel-${section}`}
                  onClick={() => setChosen(section)}
                >
                  {t(`missions.tabs.${section}`)}
                </button>
              ))}
            </div>
          )}
          <div className="mission-layout" data-wide={wide || undefined}>
            <div className="mission-layout__side">
              <section
                className="mission-panel"
                data-testid="mission-panel-features"
                id="mission-panel-features"
                role={wide ? undefined : 'tabpanel'}
                aria-label={t('missions.features.title')}
                hidden={!shown('features')}
              >
                <h3 className="mission-panel__title">{t('missions.features.title')}</h3>
                <FeatureList features={view?.features ?? []} />
              </section>
              <section
                className="mission-panel"
                data-testid="mission-panel-workers"
                id="mission-panel-workers"
                role={wide ? undefined : 'tabpanel'}
                aria-label={t('missions.workers.title')}
                hidden={!shown('workers')}
              >
                <h3 className="mission-panel__title">{t('missions.workers.title')}</h3>
                <LastActivity timestamp={view?.lastActivity} />
                <WorkerList workers={view?.workers ?? []} />
                <h4 className="mission-panel__subtitle">{t('missions.progress.title')}</h4>
                <ProgressLog entries={view?.progressLog ?? []} />
              </section>
            </div>
            {threadPanel}
          </div>
        </>
      )}
    </div>
  );
}
