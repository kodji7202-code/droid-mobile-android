import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { NotFoundScreen, RouteErrorBoundary } from './RouteErrorBoundary';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { SessionsScreen } from '../features/sessions/SessionsScreen';
import { SessionScreen } from '../features/session/SessionScreen';
import { WorkspaceScreen } from '../features/workspace/WorkspaceScreen';
import { CommandsLayout } from '../features/extensions/commands/CommandsLayout';
import { CommandsScreen } from '../features/extensions/commands/CommandsScreen';
import { ExtensionsScreen } from '../features/extensions/ExtensionsScreen';
import { McpDetailScreen } from '../features/extensions/mcp/McpDetailScreen';
import { McpLayout } from '../features/extensions/mcp/McpLayout';
import { McpScreen } from '../features/extensions/mcp/McpScreen';
import { MarketplacesScreen } from '../features/extensions/plugins/MarketplacesScreen';
import { PluginsLayout } from '../features/extensions/plugins/PluginsLayout';
import { PluginsScreen } from '../features/extensions/plugins/PluginsScreen';
import { SkillDetailScreen } from '../features/extensions/skills/SkillDetailScreen';
import { SkillsLayout } from '../features/extensions/skills/SkillsLayout';
import { SkillsScreen } from '../features/extensions/skills/SkillsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { AppearanceScreen } from '../features/settings/AppearanceScreen';
import { LanguageScreen } from '../features/settings/LanguageScreen';
import { ConnectionScreen } from '../features/settings/ConnectionScreen';
import { AboutScreen } from '../features/settings/AboutScreen';
import { SecurityScreen } from '../features/settings/SecurityScreen';
import { DefaultsScreen } from '../features/settings/DefaultsScreen';

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
        { path: 'sessions/:id', element: <SessionScreen /> },
        { path: 'workspace', element: <WorkspaceScreen /> },
        { path: 'extensions', element: <ExtensionsScreen /> },
        {
          path: 'extensions/mcp',
          element: <McpLayout />,
          children: [
            { index: true, element: <McpScreen /> },
            { path: ':name', element: <McpDetailScreen /> },
          ],
        },
        {
          path: 'extensions/skills',
          element: <SkillsLayout />,
          children: [
            { index: true, element: <SkillsScreen /> },
            { path: ':name', element: <SkillDetailScreen /> },
          ],
        },
        {
          path: 'extensions/commands',
          element: <CommandsLayout />,
          children: [{ index: true, element: <CommandsScreen /> }],
        },
        {
          path: 'extensions/plugins',
          element: <PluginsLayout />,
          children: [
            { index: true, element: <PluginsScreen /> },
            { path: 'marketplaces', element: <MarketplacesScreen /> },
          ],
        },
        { path: 'settings', element: <SettingsScreen /> },
        { path: 'settings/appearance', element: <AppearanceScreen /> },
        { path: 'settings/language', element: <LanguageScreen /> },
        { path: 'settings/connection', element: <ConnectionScreen /> },
        { path: 'settings/security', element: <SecurityScreen /> },
        { path: 'settings/defaults', element: <DefaultsScreen /> },
        { path: 'settings/about', element: <AboutScreen /> },
        { path: '*', element: <NotFoundScreen /> },
      ],
    },
    { path: 'connect', element: <ConnectScreen />, errorElement: <RouteErrorBoundary /> },
  ];
}
