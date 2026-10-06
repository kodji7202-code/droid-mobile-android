import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import localRules from '../../../../tools/eslint/no-hardcoded-strings.mjs';

function lint(code: string): string[] {
  const linter = new Linter();
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { local: localRules },
        rules: { 'local/no-hardcoded-strings': 'error' },
      },
    ],
    { filename: 'Sample.tsx' },
  );
  return messages.map((message) => message.messageId ?? message.message);
}

describe('local/no-hardcoded-strings', () => {
  it('reports literal JSX text', () => {
    expect(lint('export const A = () => <button>Click me</button>;')).toEqual(['jsxText']);
  });

  it('reports literal string expression children', () => {
    expect(lint("export const A = () => <p>{'Click me'}</p>;")).toEqual(['jsxText']);
  });

  it('reports literal aria-label, placeholder, title and alt attributes', () => {
    const code = `export const A = () => (
      <div>
        <input aria-label="Name" placeholder={'Your name'} />
        <img alt="Logo" title="Droid" />
      </div>
    );`;
    expect(lint(code)).toEqual(['attribute', 'attribute', 'attribute', 'attribute']);
  });

  it('reports literal toast and notify messages but not their kind argument', () => {
    expect(lint("showToast('Saved', 'success'); notify('Saved');")).toEqual(['notify', 'notify']);
  });

  it('accepts translated text, test ids, symbols and machine-format examples', () => {
    const code = `export const A = ({ t }) => (
      <button data-testid="save-button" className="btn" aria-label={t('save')}>
        {t('save')} &times; <span>{'×'}</span>
        <input placeholder="https://example.com/mcp" />
      </button>
    );`;
    expect(lint(code)).toEqual([]);
  });
});
