const fs = require('fs');
const path = require('path');
const {
  COMPOSITION_ROOTS,
  LEGACY_RUNTIME_IMPORT_ALLOWLIST,
} = require('./runtime-import-boundary.config');

const BACKEND_DIR = path.resolve(__dirname, '../../backend');
const SRC_DIR = path.join(BACKEND_DIR, 'src');
const COMPOSITION_ROOT_SET = new Set(COMPOSITION_ROOTS.map(normalizePath));
const LEGACY_ALLOWLIST = new Set(
  LEGACY_RUNTIME_IMPORT_ALLOWLIST.map(normalizePath),
);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveRuntimeTarget(importerFile, rawImportPath) {
  if (!rawImportPath.startsWith('.')) {
    return null;
  }
  const absolutePath = path.resolve(path.dirname(importerFile), `${rawImportPath}.ts`);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return normalizePath(path.relative(BACKEND_DIR, absolutePath));
}

function collectRuntimeImports() {
  const importRegex = /from\s+['"]([^'"]+\/runtime)['"]/g;
  const records = [];

  for (const file of walk(SRC_DIR)) {
    const content = fs.readFileSync(file, 'utf8');
    const importer = normalizePath(path.relative(BACKEND_DIR, file));
    let match = importRegex.exec(content);
    while (match) {
      const target = resolveRuntimeTarget(file, match[1]);
      if (target) {
        records.push({ importer, target });
      }
      match = importRegex.exec(content);
    }
  }

  return records;
}

function groupByImporter(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.importer)) {
      grouped.set(record.importer, new Set());
    }
    grouped.get(record.importer).add(record.target);
  }
  return grouped;
}

function printGroup(title, grouped) {
  console.log(title);
  for (const [importer, targets] of grouped.entries()) {
    console.log(`- ${importer}`);
    for (const target of Array.from(targets).sort()) {
      console.log(`  -> ${target}`);
    }
  }
}

function classifyImporter(importer) {
  if (importer.endsWith('.controller.ts')) return 'controllers';
  if (importer.endsWith('.module.ts')) return 'modules';
  if (importer.endsWith('.service.ts')) return 'services';
  if (importer.includes('/utils/')) return 'utils';
  if (importer.endsWith('.spec.ts')) return 'tests';
  if (importer.includes('/entities/')) return 'entities';
  if (importer.includes('/adapters/')) return 'adapters';
  return 'others';
}

function printLegacyCategorySummary(grouped) {
  const counters = new Map();
  for (const importer of grouped.keys()) {
    const category = classifyImporter(importer);
    counters.set(category, (counters.get(category) || 0) + 1);
  }
  if (counters.size === 0) {
    return;
  }

  console.log('\nlegacy importer categories');
  for (const [category, count] of Array.from(counters.entries()).sort()) {
    console.log(`- ${category}: ${count}`);
  }
}

function main() {
  const records = collectRuntimeImports();
  const grouped = groupByImporter(records);
  const composition = new Map();
  const legacy = new Map();
  const violations = new Map();

  for (const [importer, targets] of grouped.entries()) {
    if (COMPOSITION_ROOT_SET.has(importer)) {
      composition.set(importer, targets);
      continue;
    }
    if (LEGACY_ALLOWLIST.has(importer)) {
      legacy.set(importer, targets);
      continue;
    }
    violations.set(importer, targets);
  }

  console.log(`runtime import records: ${records.length}`);
  console.log(`composition importers: ${composition.size}`);
  console.log(`legacy importers: ${legacy.size}`);
  console.log(`unknown importers: ${violations.size}`);

  const staleAllowlist = Array.from(LEGACY_ALLOWLIST).filter(
    (importer) => !legacy.has(importer),
  );
  console.log(`stale allowlist entries: ${staleAllowlist.length}`);

  if (legacy.size > 0) {
    printGroup('\nlegacy runtime importers', legacy);
    printLegacyCategorySummary(legacy);
  }

  if (staleAllowlist.length > 0) {
    console.log('\nstale runtime allowlist entries');
    for (const importer of staleAllowlist) {
      console.log(`- ${importer}`);
    }
  }

  if (violations.size > 0) {
    printGroup('\nunknown runtime importers', violations);
    process.exit(1);
  }

  if (staleAllowlist.length > 0) {
    process.exit(1);
  }

  console.log('\nruntime import boundary check passed');
}

main();
