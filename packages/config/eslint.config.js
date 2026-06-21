import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared flat ESLint configuration for OpenRelay workspaces.
 *
 * Consumers extend it from their own `eslint.config.js`:
 *
 * ```js
 * import { config } from '@openrelay/config/eslint';
 * export default config({ tsconfigRootDir: import.meta.dirname });
 * ```
 *
 * @param {{ tsconfigRootDir: string, ignores?: string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function config({ tsconfigRootDir, ignores = [] }) {
  return tseslint.config(
    {
      ignores: [
        'dist/**',
        '.next/**',
        'coverage/**',
        'node_modules/**',
        '**/*.config.js',
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.node },
        parserOptions: {
          projectService: {
            allowDefaultProject: ['*.config.js', '*.config.mjs'],
            defaultProject: 'tsconfig.json',
          },
          tsconfigRootDir,
        },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          { allowNumber: true, allowBoolean: true },
        ],
        'no-console': 'off',
      },
    },
    prettier,
  );
}

export default config;
