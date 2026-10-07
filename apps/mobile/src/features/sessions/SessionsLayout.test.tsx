import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAppAt } from '../../test/render-app';
import { stubMatchMedia } from '../../test/match-media';
import { useInteractionStore } from '../../stores/interactions';

describe('SessionsLayout', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    window.localStorage.clear();
  });

  it('shows only the list on a phone at /sessions', () => {
    renderAppAt('/sessions');
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('sessions-layout')).not.toBeInTheDocument();
  });

  it('replaces the list with the chat on a phone at /sessions/:id and keeps back', () => {
    renderAppAt('/sessions/s1');
    expect(screen.getByTestId('session-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('sessions-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-back')).toBeInTheDocument();
  });

  it('shows the list next to a select-a-session prompt on a tablet at /sessions', () => {
    restore = stubMatchMedia(true);
    renderAppAt('/sessions');
    expect(screen.getByTestId('sessions-layout')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-select-session')).toBeInTheDocument();
  });

  it('keeps the list beside the open chat on a tablet and drops the back control', () => {
    restore = stubMatchMedia(true);
    renderAppAt('/sessions/s1');
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
    expect(screen.getByTestId('session-screen')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-detail')).toContainElement(
      screen.getByTestId('session-screen'),
    );
    expect(screen.queryByTestId('session-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sessions-select-session')).not.toBeInTheDocument();
  });

  describe('while a request dialog is open in the chat pane', () => {
    afterEach(() => {
      act(() => useInteractionStore.getState().reset());
    });

    function requestFor(sessionId: string) {
      act(() => {
        void useInteractionStore.getState().requestPermission(sessionId, {
          toolUses: [],
          options: [],
        } as never);
      });
    }

    it('makes the session list inert so another session cannot be opened', () => {
      restore = stubMatchMedia(true);
      renderAppAt('/sessions/s1');
      expect(screen.getByTestId('sessions-screen')).not.toHaveAttribute('inert');
      requestFor('s1');
      expect(screen.getByTestId('sessions-screen')).toHaveAttribute('inert');
      expect(screen.getByTestId('sessions-screen').closest('[inert]')).not.toBeNull();
      expect(screen.getByTestId('sessions-detail').closest('[inert]')).toBeNull();
    });

    it('keeps the list usable when the pending request belongs to another session', () => {
      restore = stubMatchMedia(true);
      renderAppAt('/sessions/s2');
      requestFor('s1');
      expect(screen.getByTestId('sessions-screen')).not.toHaveAttribute('inert');
    });
  });
});
