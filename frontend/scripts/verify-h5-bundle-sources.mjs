import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(frontendRoot, 'dist', 'build', 'h5');
const packageLock = JSON.parse(
  await readFile(resolve(frontendRoot, 'package-lock.json'), 'utf8'),
);

const safeIntlifyPath = 'node_modules/vue-i18n/node_modules/@intlify/';
const safeIntlifyVersion =
  packageLock.packages?.[
    'node_modules/vue-i18n/node_modules/@intlify/core-base'
  ]?.version;
if (safeIntlifyVersion !== '9.14.5') {
  throw new Error(
    `unexpected browser Intlify version: ${safeIntlifyVersion || 'missing'}`,
  );
}

const forbiddenBuildPackages = [
  '@dcloudio/uni-cli-shared',
  'nanoid',
  'postcss',
  'vite',
  'adm-zip',
  'browserslist',
  'immutable',
  'jpeg-js',
  'picomatch',
  'ws',
];

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}

const outputFiles = await walk(outputRoot);
const maps = outputFiles.filter((path) => extname(path) === '.map');
if (maps.length === 0) {
  throw new Error(
    'bundle audit requires BOOKING_BUNDLE_AUDIT=true hidden source maps',
  );
}

const mapSet = new Set(maps);
const scripts = outputFiles.filter((path) => extname(path) === '.js');
const scriptsWithoutMaps = scripts.filter((path) => !mapSet.has(`${path}.map`));
if (scriptsWithoutMaps.length > 0) {
  throw new Error(
    `bundle audit is incomplete; JavaScript files lack source maps:\n${scriptsWithoutMaps.join('\n')}`,
  );
}

const violations = [];
for (const path of maps) {
  const map = JSON.parse(await readFile(path, 'utf8'));
  for (const rawSource of map.sources || []) {
    const source = String(rawSource).replaceAll('\\', '/');
    const intlify = source.includes('node_modules/@intlify/');
    if (intlify && !source.includes(safeIntlifyPath)) {
      violations.push(`${path}: vulnerable build-time Intlify source: ${source}`);
    }
    for (const packageName of forbiddenBuildPackages) {
      if (source.includes(`node_modules/${packageName}/`)) {
        violations.push(`${path}: build-only package entered H5: ${source}`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(violations.join('\n'));
}

process.stdout.write(
  `H5_BUNDLE_DEPENDENCY_PASS scripts=${scripts.length} maps=${maps.length} browserIntlify=${safeIntlifyVersion}\n`,
);
