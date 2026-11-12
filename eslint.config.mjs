// ESLint flat config for the whole monorepo (pnpm lint → eslint . --max-warnings=0).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-web/**',
      '**/dist-native/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'apps/api/data/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      // React Native bundles static assets via require('./x.png')
      '@typescript-eslint/no-require-imports': ['error', { allow: ['\\.(png|jpe?g|gif|webp)$'] }],
    },
  },
  // Browser / React Native UI code
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}', 'packages/client/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // Node code: API server, build scripts, tests, tooling configs
  {
    files: ['apps/api/**/*.{ts,mjs}', 'e2e/**/*.ts', '**/*.config.{ts,mjs}', '**/*.test.ts', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Playwright fixtures are destructured even when unused: test('x', async ({}, info) => …)
  {
    files: ['e2e/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  // CommonJS config files used by Expo/Metro/Babel
  {
    files: ['apps/mobile/babel.config.js', 'apps/mobile/metro.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/mobile/index.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
