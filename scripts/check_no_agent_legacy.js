const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../frontend/src');
const exts = new Set(['.ts', '.js', '.vue', '.json']);
const ignoreDirs = new Set(['node_modules', 'dist', 'unpackage']);

const legacyPatterns = [
  {
    label: 'legacy_api_path',
    regex: /['"`]\/agent\/[^'"`]*['"`]/g,
  },
  {
    label: 'legacy_page_path',
    regex: /pages\/agent\/[a-zA-Z0-9_-]+/g,
  },
  {
    label: 'legacy_agent_api_import',
    regex: /@\/api\/agent\b|from\s+['"]\.\/agent['"]/g,
  },
];

const violations = [];

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
      continue;
    }
    if (!exts.has(path.extname(entry.name))) continue;
    const content = fs.readFileSync(abs, 'utf8');
    const matches = [];
    for (const p of legacyPatterns) {
      const hit = content.match(p.regex);
      if (hit && hit.length) {
        for (const m of hit) {
          matches.push({ label: p.label, value: m });
        }
      }
    }
    if (!matches.length) continue;
    const normalized = matches
      .map((m) => `${m.label}: ${m.value}`)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    violations.push({ file: abs, matches: normalized });
  }
};

walk(rootDir);

if (violations.length) {
  console.error('发现遗留 agent 语义/路径，请迁移到 distribution/agency：');
  for (const item of violations) {
    console.error(`- ${item.file}`);
    for (const value of item.matches) {
      console.error(`  ${value}`);
    }
  }
  process.exit(1);
}

console.log('未发现遗留 agent 语义/路径。');

