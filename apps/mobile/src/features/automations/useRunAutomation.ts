import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Automation, DaemonConnection } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';

export type RunPhase = 'idle' | 'confirming' | 'starting';

/**
 * Run now: the daemon only returns a descriptor, so the app opens the session
 * in the automation directory and sends the prompt itself. Nothing is created
 * (and nothing is spent) until the user confirms.
 */
export function useRunAutomation(connection: DaemonConnection | null) {
  const navigate = useNavigate();
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const [target, setTarget] = useState<Automation | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [failed, setFailed] = useState(false);

  const request = useCallback((automation: Automation) => {
    setFailed(false);
    setTarget(automation);
    setPhase('confirming');
  }, []);

  const cancel = useCallback(() => {
    setPhase('idle');
    setTarget(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!connection || !target) return;
    setPhase('starting');
    setFailed(false);
    try {
      const descriptor = await connection.automations.run(target.id);
      const trust = await connection.checkFolderTrust(descriptor.cwd);
      if (trust.promptRequired) await connection.trustFolder(descriptor.cwd);
      const handle = await connection.createSession({
        cwd: descriptor.cwd,
        ...(descriptor.model ? { modelId: descriptor.model } : {}),
      });
      useSessionViewStore.getState().adopt(handle, readyEpoch);
      // Sending marks the turn active, which keeps the opening screen from re-reading the new session.
      void useSessionViewStore.getState().send(handle.id, descriptor.prompt);
      setPhase('idle');
      setTarget(null);
      navigate(`/sessions/${handle.id}`);
    } catch {
      setFailed(true);
      setPhase('idle');
      setTarget(null);
    }
  }, [connection, target, readyEpoch, navigate]);

  return { target, phase, failed, request, cancel, confirm };
}
