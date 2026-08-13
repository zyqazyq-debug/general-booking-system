/** @type {import('dependency-cruiser').IConfiguration} */
// eslint-disable-next-line no-undef
module.exports = {
  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', 'unpackage', '\\.d\\.ts$'],
    },
    exclude: {
      path: ['^node_modules', '^dist', '^unpackage'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
  },
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Disallow files that are not part of the dependency graph',
      severity: 'warn',
      from: { orphan: true, pathNot: ['^src/main\\.ts$', '^src/pages/'] },
      to: {},
    },
    {
      name: 'no-deep-import-from-domains',
      comment: 'pages/shared/core/components 不允许深引 domains 内部实现，跨域只能走各域 index.ts 门面',
      severity: 'error',
      from: { path: '^src/(pages|shared|core|components)/' },
      to: { path: '^src/domains/.+/(api|components|pages|composables|stores|services)/' },
    },
    {
      name: 'pages-should-not-import-pages',
      severity: 'error',
      from: { path: '^src/pages/' },
      to: { path: '^src/pages/', pathNot: ['^src/pages/index/', '^src/pages/provider/dashboard/PCDashboard\\.vue$', '^src/pages/provider/dashboard/MobileDashboard\\.vue$'] },
    },
    {
      name: 'shared-no-import-from-domains',
      comment: 'shared 是基础层，不允许反向依赖业务域',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/domains/' },
    },
    {
      name: 'core-no-import-from-domains',
      comment: 'core 是基建层，不允许反向依赖业务域',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/domains/' },
    },
  ],
};
