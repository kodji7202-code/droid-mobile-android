/*
 * ESLint rule: user-visible text must come from the i18n bundles.
 *
 * Reports string literals that contain a letter when they are
 *  - JSX text or `{'literal'}` JSX children,
 *  - the value of an accessible-text attribute (aria-label, placeholder, title, alt, ...),
 *  - an argument of a toast/notify style call.
 * Literals without letters (icons such as "×", separators, numbers) are ignored.
 * Test ids (`data-testid`), class names, routes and other machine values are not
 * inspected. Use `// eslint-disable-next-line local/no-hardcoded-strings -- <reason>`
 * for the rare brand or protocol name that must stay literal.
 */

const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'title',
  'alt',
  'label',
]);

const NOTIFY_CALLEES = new Set(['toast', 'notify', 'showToast', 'showNotification', 'alert']);

const HAS_LETTER = /\p{L}/u;

// Machine-format example values that are identical in every language.
const LITERAL_ALLOWLIST = new Set(['node', 'Factory-AI/factory-plugins']);
const URL_VALUE = /^(?:https?|wss?):\/\/\S+$/;

function isUserText(text) {
  return HAS_LETTER.test(text) && !LITERAL_ALLOWLIST.has(text) && !URL_VALUE.test(text);
}

function staticText(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? '').join('');
  }
  return null;
}

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noHardcodedStrings = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      jsxText: 'Hard-coded user-visible text {{text}}; use t() with keys in en.json and ro.json.',
      attribute:
        'Hard-coded "{{name}}" attribute {{text}}; use t() with keys in en.json and ro.json.',
      notify: 'Hard-coded notification text {{text}}; use t() with keys in en.json and ro.json.',
    },
  },
  create(context) {
    const report = (node, messageId, text, name) => {
      const shown = JSON.stringify(text.trim().replace(/\s+/g, ' ').slice(0, 40));
      context.report({ node, messageId, data: { text: shown, name: name ?? '' } });
    };

    return {
      JSXText(node) {
        if (isUserText(node.value.trim())) report(node, 'jsxText', node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXAttribute') return;
        const text = staticText(node.expression);
        if (text !== null && isUserText(text.trim())) report(node, 'jsxText', text);
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !TEXT_ATTRIBUTES.has(node.name.name)) return;
        const value =
          node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        const text = staticText(value);
        if (text !== null && isUserText(text.trim())) {
          report(node, 'attribute', text, node.name.name);
        }
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!name || !NOTIFY_CALLEES.has(name)) return;
        // Only the message (first argument) is text; later ones are kinds/options.
        const text = staticText(node.arguments[0]);
        if (text !== null && isUserText(text.trim())) report(node.arguments[0], 'notify', text);
      },
    };
  },
};

export default {
  rules: { 'no-hardcoded-strings': noHardcodedStrings },
};
