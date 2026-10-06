import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SlashCommand } from '@droidmobile/daemon-client';
import { filterCommands, insertCommand, slashQuery } from './slashCommands';

export type SlashState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; commands: readonly SlashCommand[] };

interface Options {
  draft: string;
  loadCommands?: () => Promise<readonly SlashCommand[]>;
  onPick(text: string): void;
}

/**
 * Autocomplete for custom slash commands while the draft is a single `/token`.
 * The list is read from the daemon each time the popup opens, so a command file
 * added since the last time shows up without reopening the session.
 */
export function useSlashAutocomplete({ draft, loadCommands, onPick }: Options) {
  const query = loadCommands ? slashQuery(draft) : null;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [state, setState] = useState<SlashState>({ status: 'loading' });
  const [active, setActive] = useState(0);
  const loader = useRef(loadCommands);
  loader.current = loadCommands;
  // Escape hides the popup for that exact draft; any further edit shows it again.
  const open = query !== null && draft !== dismissedFor;

  // Once the draft has left the dismissed text, typing it again is a fresh request.
  useEffect(() => {
    if (dismissedFor !== null && draft !== dismissedFor) setDismissedFor(null);
  }, [draft, dismissedFor]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setState({ status: 'loading' });
    loader.current?.().then(
      (commands) => {
        if (current) setState({ status: 'ready', commands });
      },
      () => {
        if (current) setState({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [open]);

  const matches = useMemo(
    () => (open && state.status === 'ready' ? filterCommands(state.commands, query ?? '') : []),
    [open, state, query],
  );

  useEffect(() => setActive(0), [query]);

  const pick = (command: SlashCommand) => onPick(insertCommand(command.name));

  /** Returns true when the key was used by the popup and must not reach the textarea. */
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === 'Escape') {
      setDismissedFor(draft);
      return true;
    }
    if (matches.length === 0) return false;
    if (event.key === 'ArrowDown') {
      setActive((index) => (index + 1) % matches.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      setActive((index) => (index - 1 + matches.length) % matches.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      pick(matches[Math.min(active, matches.length - 1)]!);
      return true;
    }
    return false;
  };

  return { open, state, matches, active, pick, onKeyDown };
}
