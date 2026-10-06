import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import localRules from './tools/eslint/no-hardcoded-strings.mjs';

export default tseslint.config(
  {
    // Location-agnostic patterns (match at any depth) so the same config serves
    // both the root `eslint .` and per-workspace `eslint .` runs. android/ is a
    // generated native project and never contains lintable app sources.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.tmp/**',
      '**/android/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // The TypeScript compiler catches undefined names; keep core no-undef off
      // so vitest globals and DOM/node ambient types do not trip it.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    // Fixture routes are development-only and absent from the production bundle.
    ignores: ['**/*.test.{ts,tsx}', 'apps/mobile/src/test/**', '**/__fixtures__/**'],
    plugins: { local: localRules },
    rules: { 'local/no-hardcoded-strings': 'error' },
  },
  {
    files: ['**/*.{ts,tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
