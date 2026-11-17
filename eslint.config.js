import stylistic from '@stylistic/eslint-plugin';
import formatScope from './.source-format.json' with { type: 'json' };
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
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
  { files: ['**/*.test.ts', '**/*.test.tsx'], rules: { 'max-lines': ['error', 500], 'max-lines-per-function': 'off' } },
);
