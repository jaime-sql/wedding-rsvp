import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'supabase/functions/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['tests/**/*.ts', 'vitest.config.ts', 'astro.config.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
