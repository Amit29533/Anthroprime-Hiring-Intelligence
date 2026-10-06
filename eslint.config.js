import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Bug-hunting configuration. The rules enabled here are the ones that catch real
// runtime failures (undeclared identifiers, broken hooks) rather than style.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'releases/**', 'artifacts/**'] },
  js.configs.recommended,
  {
    files: [
      'src/**/*.{js,jsx}',
      'tests/**/*.{js,jsx,mjs}',
      'netlify/functions/**/*.js',
      'scanner/**/*.{js,mjs}',
      '*.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19.1' } },
    plugins: { react: react, 'react-hooks': reactHooks },
    rules: {
      // A reference to an identifier that is never declared is a guaranteed
      // ReferenceError at runtime — the single most valuable rule for this codebase.
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^React$' }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-fallthrough': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
      'no-misleading-character-class': 'error',
      'no-prototype-builtins': 'off',
      'react/jsx-no-undef': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-key': 'warn',
      'react/no-unknown-property': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Test files additionally use node:test globals.
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
