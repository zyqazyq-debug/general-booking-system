const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const roots = ['domains', 'platforms', 'shared', 'health', 'init', 'system-config'];
const importRegex = /(from\s+['"])([^'"]+)(['"])|(\brequire\(\s*['"])([^'"]+)(['"]\s*\))/g;

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function stripExt(p) {
  return p.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
}

function walkTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function resolveFileNoExt(absNoExt) {
  const candidates = [
    absNoExt,
    `${absNoExt}.ts`,
    `${absNoExt}.tsx`,
    `${absNoExt}.js`,
    path.join(absNoExt, 'index.ts'),
    path.join(absNoExt, 'index.tsx'),
    path.join(absNoExt, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (c.endsWith('/index.ts') || c.endsWith('\\index.ts') || c.endsWith('/index.tsx') || c.endsWith('\\index.tsx') || c.endsWith('/index.js') || c.endsWith('\\index.js')) {
        return stripExt(path.dirname(c));
      }
      return stripExt(c);
    }
  }
  return null;
}

function collectRelativeIndex(tsFiles) {
  return tsFiles.map((f) => stripExt(toPosix(path.relative(srcRoot, f))));
}

function findBySuffix(specifierNoDot, fileRelIndex) {
  const normalized = toPosix(specifierNoDot);
  const segs = normalized.split('/').filter(Boolean);
  const suffixes = [];
  if (segs.length >= 1) suffixes.push(segs.slice(-1).join('/'));
  if (segs.length >= 2) suffixes.push(segs.slice(-2).join('/'));
  if (segs.length >= 3) suffixes.push(segs.slice(-3).join('/'));
  if (segs.length >= 4) suffixes.push(segs.slice(-4).join('/'));
  for (let i = suffixes.length - 1; i >= 0; i -= 1) {
    const suffix = suffixes[i];
    const matches = fileRelIndex.filter((x) => x.endsWith(`/${suffix}`) || x === suffix);
    if (matches.length === 1) {
      return path.join(srcRoot, matches[0]);
    }
  }
  return null;
}

function normalizeImport(filePath, rawSpecifier, fileRelIndex) {
  if (!rawSpecifier.startsWith('.')) return null;

  const fromDir = path.dirname(filePath);
  const rawNoExt = stripExt(rawSpecifier);

  let targetNoExt = null;
  const rootMatch = rawNoExt.match(/(?:^|\/)(domains|platforms|shared|health|init|system-config)(?:\/|$).*/);
  if (rootMatch) {
    const idx = rawNoExt.indexOf(rootMatch[1]);
    const tail = rawNoExt.slice(idx);
    const abs = path.join(srcRoot, ...tail.split('/'));
    targetNoExt = resolveFileNoExt(abs);
  }

  if (!targetNoExt) {
    const directAbs = path.resolve(fromDir, rawNoExt);
    targetNoExt = resolveFileNoExt(directAbs);
  }

  if (!targetNoExt) {
    const noDot = rawNoExt.replace(/^(\.\/|\.\.\/)+/, '');
    if (noDot.length > 0) {
      const bySuffix = findBySuffix(noDot, fileRelIndex);
      if (bySuffix) targetNoExt = resolveFileNoExt(bySuffix);
    }
  }

  if (!targetNoExt) return null;

  let rel = toPosix(path.relative(fromDir, targetNoExt));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (rel === rawSpecifier || rel === rawNoExt) return null;
  return rel;
}

function main() {
  const tsFiles = walkTsFiles(srcRoot);
  const fileRelIndex = collectRelativeIndex(tsFiles);
  let fileChanged = 0;
  let importChanged = 0;

  for (const file of tsFiles) {
    const before = fs.readFileSync(file, 'utf8');
    let changedInFile = 0;
    const after = before.replace(importRegex, (match, p1, p2, p3, p4, p5, p6) => {
      const prefix = p1 || p4;
      const specifier = p2 || p5;
      const suffix = p3 || p6;
      const normalized = normalizeImport(file, specifier, fileRelIndex);
      if (!normalized) return match;
      changedInFile += 1;
      return `${prefix}${normalized}${suffix}`;
    });
    if (changedInFile > 0 && after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      fileChanged += 1;
      importChanged += changedInFile;
      console.log(`fixed ${toPosix(path.relative(projectRoot, file))}: ${changedInFile}`);
    }
  }

  console.log(`done files=${fileChanged} imports=${importChanged}`);
}

main();
