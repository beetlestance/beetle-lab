import js from '@eslint/js';
export default [{...js.configs.recommended, files: ['**/*.mjs'], languageOptions: {ecmaVersion: 'latest', sourceType: 'module',
  globals: {Buffer: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly', structuredClone: 'readonly'}},
  rules: {...js.configs.recommended.rules, complexity: ['error', 10], 'max-lines': ['error', 400],
    'max-lines-per-function': ['error', {max: 80}]}}];
