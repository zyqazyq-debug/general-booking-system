import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import fs from 'node:fs';
import path from 'node:path';

const domainsDir = path.join(import.meta.dirname, 'src', 'domains');
const domainNames = fs
  .readdirSync(domainsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => /^[a-z0-9-]+$/i.test(name));

const domainImportGuards = domainNames.map((domain) => {
  const otherDomains = domainNames.filter((d) => d !== domain);
  const patterns = otherDomains.flatMap((d) => [
    `@/domains/${d}/*`,
    `@/domains/${d}/**`,
  ]);
  return {
    files: [`src/domains/${domain}/**/*.{js,ts,vue}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: patterns,
              message:
                'Strict boundary: domains 不允许跨域导入（请上浮到 src/pages 组合，或通过 src/shared 提供门面/接口）。',
            },
          ],
        },
      ],
    },
  };
});

const crossDomainAcceptedFiles = [
  'src/domains/admin/pages/AdminLoginImpl.vue',
  'src/domains/booking/pages/BookingDetailImpl.vue',
  'src/domains/booking/composables/useBookingImport.ts',
  'src/domains/distribution/api/agent.ts',
  'src/domains/distribution/api/link.ts',
  'src/domains/distribution/pages/DistributionCreateLinkImpl.vue',
  'src/domains/distribution/pages/DistributionDashboardImpl.vue',
  'src/domains/library/composables/useLibraryImportResolver.ts',
  'src/domains/login/components/TelegramLoginModal.vue',
  'src/domains/login/pages/LoginImpl.vue',
  'src/domains/login/pages/RegisterImpl.vue',
  'src/domains/provider/components/ServiceList.vue',
  'src/domains/provider/components/service-block/composables/useServiceBlockActions.ts',
  'src/domains/provider/components/service/composables/useServiceEditActions.ts',
  'src/domains/provider/components/service/composables/useServiceEditState.ts',
  'src/domains/provider/composables/useDashboardSchedule.ts',
  'src/domains/provider/composables/useDashboardServices.ts',
];

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'unpackage/**',
      '.hbuilderx/**',
      'coverage/**',
      'checkout-files.js',
      'find-*.js',
      'fix-imports.js',
      'replace.js',
      'restore*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-mutating-props': 'off',
      'vue/no-required-prop-with-default': 'off',
    },
  },
  {
    files: ['src/components/**/*.{js,ts,vue}'],
    ignores: ['src/components/panels/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@/pages/*', '@/pages/**'],
        },
      ],
    },
  },
  ...domainImportGuards,
  {
    files: crossDomainAcceptedFiles,
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
];
