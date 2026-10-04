import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { NotFoundScreen, RouteErrorBoundary } from './RouteErrorBoundary';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { SessionsScreen } from '../features/sessions/SessionsScreen';
import { WorkspaceScreen } from '../features/workspace/WorkspaceScreen';
import { ExtensionsScreen } from '../features/extensions/ExtensionsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { AppearanceScreen } from '../features/settings/AppearanceScreen';
import { LanguageScreen } from '../features/settings/LanguageScreen';
import { ConnectionScreen } from '../features/settings/ConnectionScreen';
import { AboutScreen } from '../features/settings/AboutScreen';
import { SecurityScreen } from '../features/settings/SecurityScreen';

/**
 * Route table shared by the production app (hash on web, memory on native)
 * and the component tests (memory). The connect screen is a placeholder for
 * the onboarding feature; the tab screens are placeholders until their
 * features land.
 */
export function createAppRoutes(): RouteObject[] {
  return [
    {
      element: <AppShell />,
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <Navigate to="/sessions" replace /> },
        { path: 'sessions', element: <SessionsScreen /> },
        { path: 'workspace', element: <WorkspaceScreen /> },
        { path: 'extensions', element: <ExtensionsScreen /> },
        { path: 'settings', element: <SettingsScreen /> },
        { path: 'settings/appearance', element: <AppearanceScreen /> },
        { path: 'settings/language', element: <LanguageScreen /> },
        { path: 'settings/connection', element: <ConnectionScreen /> },
        { path: 'settings/security', element: <SecurityScreen /> },
        { path: 'settings/about', element: <AboutScreen /> },
        { path: '*', element: <NotFoundScreen /> },
      ],
    },
    { path: 'connect', element: <ConnectScreen />, errorElement: <RouteErrorBoundary /> },
  ];
}
