import stylistic from '@stylistic/eslint-plugin';
import formatScope from './.source-format.json' with { type: 'json' };
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'public/**',
      'server.js',
      'runner.js',
      'loadtest.js',
      'scripts/**',
      'test/**',
      '.agent-work/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'max-lines': ['error', { max: 400 }],
      'max-lines-per-function': ['error', { max: 80 }],
      complexity: ['error', 10],
      'max-params': ['error', 5],
    },
  },
  {
    files: formatScope.roots.map((root) => `${root}/**/*.{ts,tsx,js,mjs,cjs}`),
    ignores: [
      ...formatScope.generated.map((root) => root + '**'),
      ...formatScope.nonProductionSegments.map((part) => `**/${part}/**`),
      '**/*.{test,spec}.{ts,tsx,js,mjs,cjs}',
    ],
    plugins: { '@stylistic': stylistic },
    // Literal/regex/URL contents stay intact; Prettier enforces executable layout.
    rules: {
      '@stylistic/max-len': [
        'error',
        { code: 160, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreUrls: true },
      ],
    },
  },
  // Static accessibility rules for the app's JSX; axe scans the rendered pages (tools/qualification/browser/a11y.mjs).
  { ...jsxA11y.configs.strict, files: ['web/src/**/*.tsx'] },
  {
    files: ['web/src/**/*.tsx'],
    rules: {
      // Scrollable regions and tab panels take focus so keyboard users can scroll them (axe scrollable-region-focusable).
      'jsx-a11y-x/no-noninteractive-tabindex': [
        'error',
        { tags: ['pre'], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
      // list-style: none drops list semantics in Safari; role="list" restores them.
      'jsx-a11y-x/no-redundant-roles': ['error', { nav: ['navigation'], ul: ['list'], ol: ['list'] }],
      // A label may wrap its control or point at it with htmlFor.
      'jsx-a11y-x/label-has-associated-control': ['error', { assert: 'either', depth: 3 }],
      // <details> toggles natively; onToggle observes it.
      'jsx-a11y-x/no-noninteractive-element-interactions': [
        'error',
        { handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp'] },
      ],
    },
  },
  { files: ['**/*.test.ts', '**/*.test.tsx'], rules: { 'max-lines': ['error', 500], 'max-lines-per-function': 'off' } },
);
