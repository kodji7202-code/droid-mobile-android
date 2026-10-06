import { useState } from 'react';
import { applyMissionEvent } from '@droidmobile/daemon-client';
import type { MissionView, TranscriptItem } from '@droidmobile/daemon-client';
import { Transcript } from '../../chat/Transcript';
import { MissionControl } from '../MissionControl';
import {
  MISSION_FIXTURE_MARKER,
  asMissionEvent,
  heartbeat,
  snapshotView,
  stateChanged,
  workerCompleted,
  workerStarted,
} from './missionFixtures';

const THREAD: TranscriptItem[] = [
  { kind: 'user', id: 'u1', text: 'Plan the work', delivery: 'sent' },
  {
    kind: 'assistant',
    id: 'a1',
    streaming: false,
    text: 'Here is the plan:\n\n```ts\nconst milestones = 3;\n```\n',
  },
];

/** Development-only page: Mission Control over a hand-written fixture, no daemon needed. */
export function Component() {
  const [view, setView] = useState<MissionView>(snapshotView);
  const apply = (notification: object) =>
    setView((current) => applyMissionEvent(current, asMissionEvent(notification)));
  return (
    <main
      className="screen"
      data-testid="mission-fixture-route"
      data-fixture={MISSION_FIXTURE_MARKER}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="fixture-worker-start"
          onClick={() => apply(workerStarted('w-3'))}
        >
          Start worker
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="fixture-worker-fail"
          onClick={() => apply(workerCompleted('w-1', 2))}
        >
          Fail worker 1
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="fixture-heartbeat"
          onClick={() => apply(heartbeat(new Date().toISOString()))}
        >
          Heartbeat
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="fixture-paused"
          onClick={() => apply(stateChanged('paused'))}
        >
          Pause
        </button>
      </div>
      <MissionControl
        view={view}
        threadEmpty={false}
        thread={<Transcript items={THREAD} onRetry={() => undefined} />}
      />
    </main>
  );
}
