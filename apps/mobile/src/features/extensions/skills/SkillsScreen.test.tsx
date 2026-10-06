import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, Skill, SkillList } from '@droidmobile/daemon-client';
import { AppProviders, renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionViewStore } from '../../../stores/sessionView';
import { SkillDetail } from './SkillDetailScreen';

const BUILTIN: Skill = {
  name: 'tuistory',
  description: 'Automates terminal user interface testing.',
  location: 'builtin',
  filePath: 'builtin:tuistory',
  enabled: true,
};
const PERSONAL: Skill = {
  name: 'openchatcut',
  description: 'Connect an agent to OpenChatCut.',
  location: 'personal',
  filePath: 'C:\\Users\\a\\.agents\\skills\\openchatcut\\SKILL.md',
  enabled: true,
};
const PROJECT: Skill = {
  name: 'val-proj-skill',
  description: 'Validation project skill',
  location: 'project',
  filePath: 'C:\\scratch\\.factory\\skills\\val-proj-skill\\SKILL.md',
  enabled: true,
};
const AUTOMATION: Skill = {
  name: 'nightly',
  location: 'automation',
  filePath: 'C:\\Users\\a\\.factory\\automations\\nightly\\SKILL.md',
  enabled: true,
};
const ODD: Skill = {
  name: 'mystery',
  description: 'From somewhere new.',
  location: 'plugin',
  filePath: 'plugin:mystery',
  enabled: true,
};

type SkillsApi = DaemonConnection['skills'];

function setup(
  initial: Skill[],
  {
    projectAvailable = true,
    overrides = {},
  }: { projectAvailable?: boolean; overrides?: Partial<SkillsApi> } = {},
  path = '/extensions/skills',
) {
  const state = { skills: initial.map((skill) => ({ ...skill })) };
  const skills = {
    list: vi.fn(async (): Promise<SkillList> => ({
      skills: state.skills.map((skill) => ({ ...skill })),
      projectAvailable,
    })),
    setDisabled: vi.fn(
      async (input: { name: string; disabled: boolean; level: 'user' | 'project' }) => {
        const skill = state.skills.find((item) => item.name === input.name);
        if (!skill) return;
        if (input.disabled) {
          skill.enabled = false;
          const levels = skill.disabledBy?.kind === 'ledger' ? skill.disabledBy.levels : [];
          skill.disabledBy = { kind: 'ledger', levels: [...levels, input.level] };
        } else {
          const levels =
            skill.disabledBy?.kind === 'ledger'
              ? skill.disabledBy.levels.filter((level) => level !== input.level)
              : [];
          skill.enabled = levels.length === 0;
          if (levels.length === 0) delete skill.disabledBy;
          else skill.disabledBy = { kind: 'ledger', levels };
        }
      },
    ),
    release: vi.fn(async () => {}),
    ...overrides,
  } as unknown as SkillsApi;
  const connection = { skills } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt(path, { connection });
  if (projectFolder) {
    act(() => {
      useSessionViewStore.setState({
        activeSessionId: 's1',
        views: { s1: { cwd: projectFolder } } as never,
      });
    });
  }
  return { state, skills };
}

let projectFolder: string | undefined;

/** Records the folder the next render opens; mounting the app resets the session store, so it is seeded afterwards. */
function openProject(cwd: string) {
  projectFolder = cwd;
}

afterEach(() => {
  projectFolder = undefined;
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
    useSessionViewStore.setState({ activeSessionId: null, views: {} });
  });
});

describe('SkillsScreen list', () => {
  it('shows a labelled loading state while the daemon list is pending', () => {
    setup([], { overrides: { list: () => new Promise<SkillList>(() => {}) } });
    expect(screen.getByTestId('skills-loading')).toHaveAccessibleName('Loading skills');
    expect(screen.queryByTestId('skills-empty')).not.toBeInTheDocument();
  });

  it('shows the localized empty state for an empty daemon result', async () => {
    setup([]);
    const empty = await screen.findByTestId('skills-empty');
    expect(empty).toHaveTextContent('No skills');
    expect(
      within(screen.getByTestId('skills-list')).getByTestId('skills-empty'),
    ).toBeInTheDocument();
  });

  it('shows an error with retry when the daemon does not answer, then recovers', async () => {
    const list = vi
      .fn<() => Promise<SkillList>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ skills: [BUILTIN], projectAvailable: false });
    setup([], { overrides: { list } });
    await screen.findByTestId('skills-error');
    await userEvent.click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('skill-row-tuistory')).toBeInTheDocument();
  });

  it('renders one row per daemon skill with name, description and origin label', async () => {
    setup([PROJECT, PERSONAL, BUILTIN, AUTOMATION, ODD]);
    const list = await screen.findByTestId('skills-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByTestId('skill-description-tuistory')).toHaveTextContent(
      'Automates terminal user interface testing.',
    );
    expect(screen.getByTestId('skill-origin-tuistory')).toHaveTextContent('Built-in');
    expect(screen.getByTestId('skill-origin-openchatcut')).toHaveTextContent('Personal');
    expect(screen.getByTestId('skill-origin-val-proj-skill')).toHaveTextContent('Project');
    expect(screen.getByTestId('skill-origin-nightly')).toHaveTextContent('Automation');
    expect(screen.getByTestId('skill-origin-mystery')).toHaveTextContent('Other');
    expect(screen.getByTestId('skill-origin-mystery')).toHaveAttribute('data-location', 'plugin');
  });

  it('shows a placeholder instead of a blank description', async () => {
    setup([AUTOMATION]);
    expect(await screen.findByTestId('skill-description-nightly')).toHaveTextContent(
      'No description provided.',
    );
  });

  it('names the project folder, or says that only user-level skills are shown', async () => {
    openProject('C:\\scratch');
    setup([BUILTIN]);
    expect(await screen.findByTestId('skills-scope')).toHaveTextContent(
      'Project folder: C:\\scratch',
    );
  });

  it('says that no project is open when there is no active session', async () => {
    setup([BUILTIN]);
    expect(await screen.findByTestId('skills-scope')).toHaveTextContent('No project is open');
  });

  it('reads the list for the open session folder', async () => {
    openProject('C:\\scratch');
    const { skills } = setup([BUILTIN]);
    await screen.findByTestId('skills-list');
    expect(skills.list).toHaveBeenCalledWith('C:\\scratch');
  });
});

describe('SkillsScreen enable switch', () => {
  it('asks for the level before disabling and sends nothing until confirmed', async () => {
    const { skills } = setup([BUILTIN]);
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    const sheet = await screen.findByTestId('skill-level-sheet');
    expect(within(sheet).getByTestId('skill-level-user')).toBeChecked();
    expect(within(sheet).getByTestId('skill-level-project')).toBeInTheDocument();
    expect(skills.setDisabled).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('skill-level-cancel'));
    expect(screen.queryByTestId('skill-level-sheet')).not.toBeInTheDocument();
    expect(skills.setDisabled).not.toHaveBeenCalled();
    expect(screen.getByTestId('skill-toggle-tuistory')).toBeChecked();
  });

  it('disables at user level and shows the daemon state afterwards', async () => {
    openProject('C:\\scratch');
    const { skills } = setup([BUILTIN]);
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    await userEvent.click(screen.getByTestId('skill-level-confirm'));
    await waitFor(() =>
      expect(skills.setDisabled).toHaveBeenCalledWith(
        { name: 'tuistory', disabled: true, level: 'user' },
        'C:\\scratch',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('skill-state-tuistory')).toHaveTextContent(
        'Disabled for all projects',
      ),
    );
    expect(screen.getByTestId('skill-toggle-tuistory')).not.toBeChecked();
  });

  it('disables at project level when a project folder is open', async () => {
    openProject('C:\\scratch');
    const { skills } = setup([PROJECT]);
    await userEvent.click(await screen.findByTestId('skill-toggle-val-proj-skill'));
    const project = screen.getByTestId('skill-level-project');
    expect(project).toBeEnabled();
    expect(screen.getByTestId('skill-level-project-hint')).toHaveTextContent('C:\\scratch');
    await userEvent.click(project);
    await userEvent.click(screen.getByTestId('skill-level-confirm'));
    await waitFor(() =>
      expect(skills.setDisabled).toHaveBeenCalledWith(
        { name: 'val-proj-skill', disabled: true, level: 'project' },
        'C:\\scratch',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('skill-state-val-proj-skill')).toHaveTextContent(
        'Disabled for this project',
      ),
    );
  });

  it('offers no project level without a project folder', async () => {
    setup([BUILTIN]);
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    expect(screen.getByTestId('skill-level-project')).toBeDisabled();
    expect(screen.getByTestId('skill-level-project-hint')).toHaveTextContent('Open a session');
  });

  it('offers no project level when the daemon says the folder cannot hold one', async () => {
    openProject('C:\\home');
    setup([BUILTIN], { projectAvailable: false });
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    expect(screen.getByTestId('skill-level-project')).toBeDisabled();
  });

  it('re-enables at the level that disabled the skill without asking again', async () => {
    openProject('C:\\scratch');
    const { skills, state } = setup([
      { ...BUILTIN, enabled: false, disabledBy: { kind: 'ledger', levels: ['user'] } },
    ]);
    expect(await screen.findByTestId('skill-state-tuistory')).toHaveTextContent(
      'Disabled for all projects',
    );
    await userEvent.click(screen.getByTestId('skill-toggle-tuistory'));
    expect(screen.queryByTestId('skill-level-sheet')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(skills.setDisabled).toHaveBeenCalledWith(
        { name: 'tuistory', disabled: false, level: 'user' },
        'C:\\scratch',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('skill-state-tuistory')).toHaveTextContent('Enabled'),
    );
    expect(state.skills[0]?.enabled).toBe(true);
  });

  it('re-enables every level of a skill disabled at both', async () => {
    openProject('C:\\scratch');
    const { skills } = setup([
      { ...BUILTIN, enabled: false, disabledBy: { kind: 'ledger', levels: ['user', 'project'] } },
    ]);
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    await waitFor(() => expect(skills.setDisabled).toHaveBeenCalledTimes(2));
    expect(skills.setDisabled).toHaveBeenCalledWith(
      { name: 'tuistory', disabled: false, level: 'user' },
      'C:\\scratch',
    );
    expect(skills.setDisabled).toHaveBeenCalledWith(
      { name: 'tuistory', disabled: false, level: 'project' },
      'C:\\scratch',
    );
  });

  it('locks a skill that its own file disabled', async () => {
    setup([{ ...BUILTIN, enabled: false, disabledBy: { kind: 'frontmatter' } }]);
    expect(await screen.findByTestId('skill-toggle-tuistory')).toBeDisabled();
    expect(screen.getByTestId('skill-state-tuistory')).toHaveTextContent(
      'Disabled by the skill file',
    );
  });

  it('keeps the daemon state and says so when a change fails', async () => {
    const { state } = setup([BUILTIN], {
      overrides: {
        setDisabled: vi.fn(async () => {
          throw new Error('refused');
        }),
      },
    });
    await userEvent.click(await screen.findByTestId('skill-toggle-tuistory'));
    await userEvent.click(screen.getByTestId('skill-level-confirm'));
    expect(await screen.findByTestId('skills-action-error')).toHaveTextContent(
      'Could not disable tuistory',
    );
    expect(screen.getByTestId('skill-toggle-tuistory')).toBeChecked();
    expect(state.skills[0]?.enabled).toBe(true);
  });

  it('closes the scratch session after leaving the section', async () => {
    const { skills } = setup([BUILTIN]);
    await screen.findByTestId('skills-list');
    await userEvent.click(screen.getByTestId('extensions-back'));
    await waitFor(() => expect(skills.release).toHaveBeenCalled());
  });
});

describe('Skill detail', () => {
  it('shows the full description, origin, state and source path of a project skill', async () => {
    openProject('C:\\scratch');
    setup([PROJECT, BUILTIN], {}, '/extensions/skills/val-proj-skill');
    expect(await screen.findByTestId('skill-detail-description')).toHaveTextContent(
      'Validation project skill',
    );
    expect(screen.getByTestId('skill-detail-origin')).toHaveTextContent('Project');
    expect(screen.getByTestId('skill-detail-state')).toHaveTextContent('Enabled');
    expect(screen.getByTestId('skill-detail-source')).toHaveTextContent(PROJECT.filePath);
  });

  it('shows builtin:<name> as the source of a built-in skill', async () => {
    setup([BUILTIN], {}, '/extensions/skills/tuistory');
    expect(await screen.findByTestId('skill-detail-source')).toHaveTextContent('builtin:tuistory');
    expect(screen.getByTestId('skill-detail-origin')).toHaveTextContent('Built-in');
  });

  it('opens from a list row', async () => {
    setup([BUILTIN]);
    await userEvent.click(await screen.findByTestId('skill-open-tuistory'));
    expect(await screen.findByTestId('skill-detail-fields')).toBeInTheDocument();
  });

  it('switches the skill from the detail view', async () => {
    const { skills } = setup([BUILTIN], {}, '/extensions/skills/tuistory');
    await userEvent.click(await screen.findByTestId('skill-detail-toggle-tuistory'));
    await userEvent.click(screen.getByTestId('skill-level-confirm'));
    await waitFor(() =>
      expect(skills.setDisabled).toHaveBeenCalledWith(
        { name: 'tuistory', disabled: true, level: 'user' },
        undefined,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('skill-detail-state')).toHaveTextContent(
        'Disabled for all projects',
      ),
    );
  });

  it('says so for a skill the daemon does not list', async () => {
    setup([BUILTIN], {}, '/extensions/skills/gone');
    expect(await screen.findByTestId('skill-detail-missing')).toHaveTextContent('gone');
  });

  it('renders a localized placeholder when the description is absent', () => {
    render(
      <AppProviders>
        <SkillDetail skill={AUTOMATION} />
      </AppProviders>,
    );
    expect(screen.getByTestId('skill-detail-description')).toHaveTextContent(
      'No description provided.',
    );
    expect(screen.getByTestId('skill-detail-origin')).toHaveTextContent('Automation');
    expect(screen.getByTestId('skill-detail-source')).toHaveTextContent(AUTOMATION.filePath);
  });
});
