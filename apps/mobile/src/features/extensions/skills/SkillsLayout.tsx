import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useConnectionStore } from '../../../stores/connection';

// Long enough for a StrictMode remount to cancel the release instead of opening a new session.
const RELEASE_DELAY_MS = 250;

let pendingRelease: ReturnType<typeof setTimeout> | null = null;

/** Wraps the skills list and detail routes so they share one scratch session until the user leaves. */
export function SkillsLayout() {
  const connection = useConnectionStore((state) => state.connection);
  useEffect(() => {
    if (pendingRelease) {
      clearTimeout(pendingRelease);
      pendingRelease = null;
    }
    const skills = connection?.skills;
    if (!skills) return undefined;
    return () => {
      pendingRelease = setTimeout(() => {
        pendingRelease = null;
        void skills.release().catch(() => undefined);
      }, RELEASE_DELAY_MS);
    };
  }, [connection]);
  return <Outlet />;
}
