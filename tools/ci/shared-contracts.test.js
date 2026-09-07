const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '../..');
const sharedRoot = path.join(repoRoot, 'packages', 'shared');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

test('shared contracts build to non-empty runtime exports', async () => {
  const entrypoint = path.join(sharedRoot, 'dist', 'index.js');
  assert.ok(
    fs.existsSync(entrypoint),
    'packages/shared/dist/index.js is missing; shared build must run first',
  );
  const contracts = await import(pathToFileURL(entrypoint).href);
  assert.ok(Object.keys(contracts).length > 0, 'shared runtime exports are empty');
  assert.equal(
    contracts.ZOrderStatusEnum?.safeParse('RESERVED').success,
    true,
    'ZOrderStatusEnum is missing or rejects RESERVED',
  );
  assert.equal(
    contracts.BusinessErrorCode?.PAYMENT_INIT_FAILED,
    'PAYMENT_INIT_FAILED',
    'BusinessErrorCode runtime contract is missing',
  );
});

test('shared sources remain pure and do not reverse-depend on applications', () => {
  const sourceRoot = path.join(sharedRoot, 'src');
  assert.ok(fs.existsSync(sourceRoot), 'packages/shared/src is missing');
  const applicationImport = new RegExp(
    String.raw`(?:from|import\s*\()\s*['"][^'"]*` +
      String.raw`(?:backend|frontend|domains|platforms)[^'"]*['"]`,
  );
  const ioImport = new RegExp(
    String.raw`(?:from|require\()\s*['"](?:node:)?` +
      String.raw`(?:fs|net|http|https|child_process)['"]`,
  );
  const forbidden = [applicationImport, /\bprocess\.env\b/, ioImport];
  const violations = [];
  for (const file of walk(sourceRoot).filter((value) => /\.[cm]?tsx?$/.test(value))) {
    const content = fs.readFileSync(file, 'utf8');
    if (forbidden.some((pattern) => pattern.test(content))) {
      violations.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(violations, [], `shared purity violations:\n${violations.join('\n')}`);
});
