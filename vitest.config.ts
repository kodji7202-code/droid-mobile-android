import { configDefaults, defineConfig } from 'vitest/config';

// Exactly two projects for the root gates (`npm run test` / `npm run test:integration`).
// The `unit` project runs in jsdom so component tests work; pure node tests are
// unaffected (node APIs remain available under the jsdom environment). The
// `integration` project runs in node and needs the real droid daemon on
// 127.0.0.1:3101 (services.yaml: droid-daemon-test). Vitest 5 requires unique
// project names, so per-package configs must not reintroduce their own projects.
export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./apps/mobile/src/test/setup.ts'],
          include: [
            'apps/*/src/**/*.test.{ts,tsx}',
            'packages/*/src/**/*.test.{ts,tsx}',
            'server/*/src/**/*.test.{ts,tsx}',
            'tools/*/src/**/*.test.{ts,tsx}',
          ],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'packages/*/src/**/*.integration.test.ts',
            'server/*/src/**/*.integration.test.ts',
            'tools/*/src/**/*.integration.test.ts',
          ],
          passWithNoTests: true,
        },
      },
    ],
  },
});
