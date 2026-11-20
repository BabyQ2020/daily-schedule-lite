import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'release/',
      '.npm-cache/',
      '.tmp/',
      'vite.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // 页面/组件不得直接读写数据库，也不得直接依赖仓储：统一走 services 层。
    // 这样「所有业务写入经 Service」可以被 lint 机器校验，而不是靠自觉。
    files: [
      'src/pages/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='db'][property.name=/^(tasks|projects|dailyPlans|workLogs|reports|tags|settings|meta)$/]",
          message: '不要直接访问数据库表，请通过 services 层读写。',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db', '@/db/*'],
              message: '页面与特性层禁止直接访问数据库，请通过 services。',
            },
            {
              group: ['@/repositories', '@/repositories/*'],
              message: '页面与特性层禁止直接使用仓储，请通过 services。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      // 测试需要直接建库、灌数据、断言表内状态。
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // 构建、打包脚本运行在 Node 环境，不是浏览器代码
    files: ['scripts/**/*.mjs', 'packaging/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
);
