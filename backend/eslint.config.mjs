// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import fs from 'node:fs';
import path from 'node:path';

const domainsDir = path.join(import.meta.dirname, 'src', 'domains');
const domainNames = fs
  .readdirSync(domainsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => /^[a-z0-9-]+$/i.test(name));

const platformsDir = path.join(import.meta.dirname, 'src', 'platforms');
const platformNames = fs
  .readdirSync(platformsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => /^[a-z0-9-]+$/i.test(name));

const relativePrefixes = [
  '../../',
  '../../../',
  '../../../../',
  '../../../../../',
  '../../../../../../',
];

const domainInternalFolders = [
  'adapters',
  'application',
  'controllers',
  'decorators',
  'domain',
  'entities',
  'guards',
  'infrastructure',
  'panel',
  'quota',
  'services',
  'utils',
];

const platformInternalFolders = [
  'application',
  'bot',
  'handlers',
  'middleware',
  'services',
  'updates',
  'utils',
];

const domainImportGuards = domainNames.map((domain) => {
  const otherDomains = domainNames.filter((d) => d !== domain);
  const patterns = otherDomains.flatMap((d) =>
    relativePrefixes.flatMap((p) =>
      domainInternalFolders.flatMap((folder) => [
        `${p}${d}/${folder}`,
        `${p}${d}/${folder}/**`,
      ]),
    ),
  );
  return {
    files: [`src/domains/${domain}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: patterns,
              message:
                '跨领域导入必须通过 domains/<domain>/index.ts（禁止直接引用对方领域内部路径）。',
            },
          ],
        },
      ],
    },
  };
});

const domainRootImportGuards = domainNames.map((domain) => {
  const otherDomains = domainNames.filter((d) => d !== domain);
  const patterns = otherDomains.flatMap((d) =>
    domainInternalFolders.flatMap((folder) => [
      `../${d}/${folder}`,
      `../${d}/${folder}/**`,
    ]),
  );
  return {
    files: [`src/domains/${domain}/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: patterns,
              message:
                '跨领域导入必须通过 domains/<domain>/index.ts（禁止直接引用对方领域内部路径）。',
            },
          ],
        },
      ],
    },
  };
});

const platformImportGuards = platformNames.map((platform) => {
  const otherPlatforms = platformNames.filter((p) => p !== platform);
  const patterns = otherPlatforms.flatMap((p) =>
    relativePrefixes.flatMap((prefix) =>
      platformInternalFolders.flatMap((folder) => [
        `${prefix}${p}/${folder}`,
        `${prefix}${p}/${folder}/**`,
      ]),
    ),
  );
  return {
    files: [`src/platforms/${platform}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: patterns,
              message:
                '跨平台导入必须通过 platforms/<platform>/index.ts（禁止直接引用对方平台内部路径）。',
            },
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      'import/no-cycle': ['error', { maxDepth: '∞' }],
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/domains/**', 'src/platforms/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/domains/*/adapters',
                '**/domains/*/adapters/**',
                '**/domains/*/application',
                '**/domains/*/application/**',
                '**/domains/*/controllers',
                '**/domains/*/controllers/**',
                '**/domains/*/decorators',
                '**/domains/*/decorators/**',
                '**/domains/*/domain',
                '**/domains/*/domain/**',
                '**/domains/*/entities',
                '**/domains/*/entities/**',
                '**/domains/*/guards',
                '**/domains/*/guards/**',
                '**/domains/*/infrastructure',
                '**/domains/*/infrastructure/**',
                '**/domains/*/panel',
                '**/domains/*/panel/**',
                '**/domains/*/quota',
                '**/domains/*/quota/**',
                '**/domains/*/services',
                '**/domains/*/services/**',
                '**/domains/*/utils',
                '**/domains/*/utils/**',
                '**/platforms/*/application',
                '**/platforms/*/application/**',
                '**/platforms/*/bot',
                '**/platforms/*/bot/**',
                '**/platforms/*/handlers',
                '**/platforms/*/handlers/**',
                '**/platforms/*/middleware',
                '**/platforms/*/middleware/**',
                '**/platforms/*/services',
                '**/platforms/*/services/**',
                '**/platforms/*/updates',
                '**/platforms/*/updates/**',
                '**/platforms/*/utils',
                '**/platforms/*/utils/**',
              ],
              message:
                '禁止导入 domains/* 或 platforms/* 的内部实现目录；请改为从契约入口 index.ts 或显式 runtime.ts 导入。',
            },
          ],
        },
      ],
    },
  },
  ...domainImportGuards,
  ...domainRootImportGuards,
  ...platformImportGuards,
);
