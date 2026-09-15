import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    // .next-*: extra build dirs (NEXT_DIST_DIR), e.g. .next-staging from `pnpm dev:staging`.
    // public/module-preview: the phone app's compiled web build (scripts/build-module-preview.mjs, D-101).
    ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', 'public/module-preview/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
];

export default config;
