import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['**/dist/', '**/coverage/', 'tests/wpt/', '.spec/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Invisible characters (e.g. U+200B) must be written as escapes, even in strings.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: false, skipTemplates: false, skipRegExps: false, skipComments: false },
      ],
      // A leading underscore marks an intentionally unused binding (e.g. omitted by destructuring).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
