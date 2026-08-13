const fs = require('fs');
const path = require('path');
const {
  COMPOSITION_ROOTS,
  LEGACY_RUNTIME_IMPORT_ALLOWLIST,
} = require('../scripts/backend/runtime-import-boundary.config');

const domainsDir = path.join(__dirname, 'src', 'domains');
const domainNames = fs
  .readdirSync(domainsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => /^[a-z0-9-]+$/i.test(name));

const RUNTIME_IMPORT_ALLOWED_FROM = [
  ...COMPOSITION_ROOTS,
  ...LEGACY_RUNTIME_IMPORT_ALLOWLIST,
].map((value) => `^${escapeForRegex(value)}$`);

const crossDomainRules = domainNames.map((domain) => ({
  name: `no-cross-domain-imports:${domain}`,
  severity: 'error',
  from: { path: `^src/domains/${domain}/` },
  to: {
    path: `^src/domains/(?!${domain}/).+`,
    pathNot: [
      `^src/domains/[^/]+/index\\.ts$`,
      `^src/domains/[^/]+/ports/`,
      `^src/domains/[^/]+/dto/`,
      `^src/domains/[^/]+/interfaces/`,
      `^src/domains/[^/]+/events/`,
      `^src/domains/[^/]+/runtime\\.ts$`,
      `^src/domains/auth/`,
    ],
  },
}));

module.exports = {
  forbidden: [
    ...crossDomainRules,
    {
      name: 'runtime-imports-should-stay-contained',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: RUNTIME_IMPORT_ALLOWED_FROM,
      },
      to: { path: '^src/.+/runtime\\.ts$' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-shared-depends-on-domains',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/domains/' },
    },
    {
      name: 'platforms-should-only-depend-on-ports',
      severity: 'error',
      from: { path: '^src/platforms/' },
      to: {
        path: '^src/domains/(?![^/]+/(ports/|index\\.ts)).+',
        pathNot: [
          `^src/domains/[^/]+/dto/`,
          `^src/domains/[^/]+/interfaces/`,
          `^src/domains/[^/]+/runtime\\.ts$`,
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
