import { matchPath, useLocation } from 'react-router';
import { useInteractionStore } from '../stores/interactions';

/**
 * True while the open session has a permission/AskUser dialog waiting. The dialog is modal: every
 * pane around it (header, navigation, tablet session list) is inert so only the dialog and Stop
 * inside it stay operable.
 */
export function useRequestModal(): boolean {
  const { pathname } = useLocation();
  const openSessionId = matchPath('/sessions/:id', pathname)?.params.id;
  return useInteractionStore((state) =>
    state.pending.some((item) => item.sessionId === openSessionId),
  );
}
