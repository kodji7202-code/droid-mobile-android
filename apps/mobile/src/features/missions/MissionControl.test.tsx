import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MissionEvent, TranscriptItem } from '@droidmobile/daemon-client';
import { stubMatchMedia } from '../../test/match-media';
import { useMissionStore } from '../../stores/missions';
import { Transcript } from '../chat/Transcript';
import { MissionControl } from './MissionControl';
import {
  PROGRESS_LOG,
  asMissionEvent,
  feature,
  featuresChanged,
  heartbeat,
  milestoneFeatures,
  progressEntry,
  snapshot,
  stateChanged,
  statusFeatures,
  workerCompleted,
  workerStarted,
} from './__fixtures__/missionFixtures';

const SESSION = 'mission-session';

function Harness({
  thread,
  threadEmpty = true,
}: {
  thread?: TranscriptItem[];
  threadEmpty?: boolean;
}) {
  const view = useMissionStore((state) => state.views[SESSION]);
  return (
    <MissionControl
      view={view}
      threadEmpty={threadEmpty}
      thread={<Transcript items={thread ?? []} onRetry={() => undefined} />}
    />
  );
}

const emit = (notification: object) =>
  act(() => useMissionStore.getState().apply(SESSION, asMissionEvent(notification)));

const rows = () => document.querySelectorAll('[data-testid^="mission-feature-"]');

let restoreMedia = () => {};
beforeEach(() => {
  restoreMedia = stubMatchMedia(true);
});
afterEach(() => {
  restoreMedia();
  act(() => useMissionStore.getState().reset());
});

describe('features list (VAL-MISSION-007)', () => {
  const labels = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  } as const;

  it.each([
    ['f-pending', 'pending'],
    ['f-progress', 'in_progress'],
    ['f-done', 'completed'],
    ['f-cancelled', 'cancelled'],
  ] as const)('renders %s with a %s status badge, description and milestone', (id, status) => {
    render(<Harness />);
    emit(featuresChanged(statusFeatures()));
    const badge = screen.getByTestId(`mission-fstatus-${id}`);
    expect(badge).toHaveTextContent(labels[status]);
    expect(badge).toHaveAttribute('data-status', status);
    expect(screen.getByTestId(`mission-feature-${id}`)).toHaveTextContent(/feature/i);
    expect(screen.getByTestId(`mission-fmilestone-${id}`)).toHaveTextContent('m1');
  });

  it('uses a distinct badge label per status', () => {
    render(<Harness />);
    emit(featuresChanged(statusFeatures()));
    const texts = ['f-pending', 'f-progress', 'f-done', 'f-cancelled'].map(
      (id) => screen.getByTestId(`mission-fstatus-${id}`).textContent,
    );
    expect(new Set(texts).size).toBe(4);
  });

  it('keeps the fixture order', () => {
    render(<Harness />);
    emit(featuresChanged(statusFeatures()));
    expect([...rows()].map((row) => row.getAttribute('data-testid'))).toEqual([
      'mission-feature-f-pending',
      'mission-feature-f-progress',
      'mission-feature-f-done',
      'mission-feature-f-cancelled',
    ]);
  });

  it('omits the milestone label for a feature without one', () => {
    render(<Harness />);
    emit(featuresChanged([feature('solo', 'pending')]));
    expect(screen.queryByTestId('mission-fmilestone-solo')).not.toBeInTheDocument();
  });

  it('replaces the list on a later event and updates only the changed badge', () => {
    render(<Harness />);
    emit(featuresChanged(statusFeatures()));
    emit(featuresChanged(statusFeatures()));
    expect(rows()).toHaveLength(4);
    const next = statusFeatures();
    next[0] = feature('f-pending', 'completed', 'm1', 'Pending feature');
    emit(featuresChanged(next));
    expect(rows()).toHaveLength(4);
    expect(screen.getByTestId('mission-fstatus-f-pending')).toHaveTextContent('Completed');
    expect(screen.getByTestId('mission-fstatus-f-progress')).toHaveTextContent('In progress');
  });
});

describe('milestone grouping (VAL-MISSION-008)', () => {
  it('groups by milestone with an ungrouped bucket and per-group progress', () => {
    render(<Harness />);
    emit(featuresChanged(milestoneFeatures()));
    expect(screen.getByTestId('mission-group-m1')).toBeInTheDocument();
    expect(screen.getByTestId('mission-group-m3')).toBeInTheDocument();
    const m2 = screen.getByTestId('mission-group-m2');
    expect(within(m2).getAllByTestId(/^mission-feature-/)).toHaveLength(4);
    expect(screen.getByTestId('mission-group-progress-m2')).toHaveTextContent('2 of 4 completed');
    expect(screen.getByTestId('mission-group-progress-m1')).toHaveTextContent('1 of 1 completed');
    const loose = screen.getByTestId('mission-group-ungrouped');
    expect(within(loose).getByTestId('mission-feature-loose')).toBeInTheDocument();
    expect(within(loose).getByRole('heading', { name: 'Ungrouped' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="mission-group-m"]')).toHaveLength(3);
  });
});

describe('workers and progress (VAL-MISSION-009)', () => {
  it('shows a started worker as running', () => {
    render(<Harness />);
    emit(workerStarted('w-1'));
    emit(workerStarted('w-2'));
    expect(screen.getByTestId('mission-worker-status-w-1')).toHaveTextContent('Running');
    expect(screen.getByTestId('mission-worker-status-w-2')).toHaveTextContent('Running');
    expect(screen.getByTestId('mission-workers').children).toHaveLength(2);
  });

  it('shows a worker that exited with 0 as completed', () => {
    render(<Harness />);
    emit(workerStarted('w-1'));
    emit(workerStarted('w-2'));
    emit(workerCompleted('w-1', 0));
    expect(screen.getByTestId('mission-worker-status-w-1')).toHaveTextContent('Completed');
    expect(screen.getByTestId('mission-worker-status-w-2')).toHaveTextContent('Running');
    expect(screen.queryByTestId('mission-worker-exit-w-1')).not.toBeInTheDocument();
  });

  it('shows a worker that exited non-zero as failed with its exit code', () => {
    render(<Harness />);
    emit(workerStarted('w-1'));
    emit(workerStarted('w-2'));
    emit(workerCompleted('w-2', 3));
    expect(screen.getByTestId('mission-worker-status-w-2')).toHaveTextContent('Failed');
    expect(screen.getByTestId('mission-worker-exit-w-2')).toHaveTextContent('Exit code 3');
    expect(screen.getByTestId('mission-worker-status-w-1')).toHaveTextContent('Running');
  });

  it('lists progress log entries in array order', () => {
    render(<Harness />);
    emit(progressEntry());
    const types = [...screen.getByTestId('mission-progress-log').children].map(
      (entry) => entry.querySelector('.mission-log__type')?.textContent,
    );
    expect(types).toEqual([
      'Mission accepted',
      'Run started',
      'Worker started',
      'Worker picked a feature',
      'Milestone validation started',
    ]);
    expect(PROGRESS_LOG).toHaveLength(5);
  });

  it('a heartbeat moves the last-activity text without adding rows', () => {
    render(<Harness />);
    emit(progressEntry());
    const before = screen.getByTestId('mission-last-activity-time');
    const text = before.textContent;
    const count = document.querySelectorAll('li').length;
    emit(heartbeat('2026-10-05T12:30:00.000Z'));
    const after = screen.getByTestId('mission-last-activity-time');
    expect(after.textContent).not.toBe(text);
    expect(after).toHaveAttribute('dateTime', '2026-10-05T12:30:00.000Z');
    expect(document.querySelectorAll('li')).toHaveLength(count);
  });
});

describe('mission state badge (VAL-MISSION-010)', () => {
  const states = [
    ['planning', 'Planning'],
    ['awaiting_input', 'Awaiting input'],
    ['initializing', 'Initializing'],
    ['running', 'Running'],
    ['paused', 'Paused'],
    ['orchestrator_turn', 'Orchestrator turn'],
    ['completed', 'Completed'],
  ] as const;

  it.each(states)('maps %s to its label', (state, label) => {
    render(<Harness />);
    emit(stateChanged(state));
    const badge = screen.getByTestId('mission-state-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-state', state);
  });

  it('uses a distinct label per state', () => {
    expect(new Set(states.map(([, label]) => label)).size).toBe(7);
  });

  it('shows a neutral unknown badge for a future state instead of throwing', () => {
    render(<Harness />);
    act(() =>
      useMissionStore.getState().apply(SESSION, {
        type: 'mission_state_changed',
        state: 'quantum',
      } as unknown as MissionEvent),
    );
    const badge = screen.getByTestId('mission-state-badge');
    expect(badge).toHaveTextContent('Unknown');
    expect(badge).toHaveClass('badge--neutral');
  });
});

describe('orchestrator thread (VAL-MISSION-011)', () => {
  it('renders an assistant markdown message with a code block like normal chat', async () => {
    render(
      <Harness
        threadEmpty={false}
        thread={[
          { kind: 'user', id: 'u1', text: 'Plan it', delivery: 'sent' },
          {
            kind: 'assistant',
            id: 'a1',
            streaming: false,
            text: 'Plan:\n\n```ts\nconst answer = 42;\n```\n',
          },
        ]}
      />,
    );
    const thread = screen.getByTestId('mission-panel-thread');
    expect(within(thread).getByTestId('msg-user-0')).toHaveTextContent('Plan it');
    const assistant = within(thread).getByTestId('msg-assistant-1');
    expect(await within(assistant).findByText(/answer/)).toBeInTheDocument();
    expect(assistant.querySelector('pre code')).not.toBeNull();
  });

  it('shows the empty-thread text when the orchestrator has said nothing', () => {
    emit(featuresChanged(statusFeatures()));
    render(<Harness />);
    expect(screen.getByTestId('mission-thread-empty')).toBeInTheDocument();
  });
});

describe('empty state (VAL-MISSION-005)', () => {
  it('shows the empty state with zero rows and no progress when nothing was reported', () => {
    render(<Harness />);
    expect(screen.getByTestId('missions-view')).toBeInTheDocument();
    expect(screen.getByText('No mission activity yet')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="mission-feature-"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="mission-group-"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="mission-worker-"]')).toHaveLength(0);
    expect(document.querySelector('progress')).toBeNull();
  });

  it('leaves the empty state once a snapshot arrives', () => {
    render(<Harness />);
    act(() => useMissionStore.getState().hydrate(SESSION, snapshot()));
    expect(screen.queryByTestId('missions-empty')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(4);
  });
});

describe('phone layout (VAL-MISSION-018)', () => {
  it('uses tabs on a narrow viewport and shows one section at a time', async () => {
    restoreMedia();
    restoreMedia = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Harness />);
    act(() => useMissionStore.getState().hydrate(SESSION, snapshot()));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByTestId('mission-panel-features')).toBeVisible();
    expect(screen.getByTestId('mission-panel-workers')).not.toBeVisible();
    await user.click(screen.getByTestId('mission-tab-workers'));
    expect(screen.getByTestId('mission-panel-workers')).toBeVisible();
    expect(screen.getByTestId('mission-panel-features')).not.toBeVisible();
  });

  it('shows the sections side by side without tabs on a wide viewport', () => {
    render(<Harness />);
    act(() => useMissionStore.getState().hydrate(SESSION, snapshot()));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('mission-panel-features')).toBeVisible();
    expect(screen.getByTestId('mission-panel-workers')).toBeVisible();
    expect(screen.getByTestId('mission-panel-thread')).toBeVisible();
  });
});
