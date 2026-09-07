const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { gates } = require('./run-quality-gates');

const repoRoot = path.resolve(__dirname, '../..');

test('quality gates are fail-closed and do not invoke fix mode', () => {
  assert.ok(gates.length >= 10, 'expected the complete gate matrix');
  const rendered = gates
    .map((gate) => [gate.name, gate.command, ...gate.args].join(' '))
    .join('\n');
  assert.doesNotMatch(rendered, /(?:^|\s)--fix(?:\s|$)/);
  assert.doesNotMatch(rendered, /lint:fix|lint-staged/);
  assert.match(rendered, /shared build/);
  assert.match(rendered, /build:h5/);
  assert.match(rendered, /verify-generated-api\.js/);
  assert.match(rendered, /check-ops-entrypoints\.js/);
});

test('all local JavaScript gate entrypoints exist', () => {
  const missing = gates
    .flatMap((gate) => gate.args)
    .filter((value) => /^tools[\\/]ci[\\/].+\.js$/.test(value))
    .filter((value) => !fs.existsSync(path.join(repoRoot, value)));
  assert.deepEqual(missing, []);
});

test('workflow never uses mutating lint commands', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/incremental-lint.yml'),
    'utf8',
  );
  const commands = workflow
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('run:'))
    .join('\n');
  assert.doesNotMatch(commands, /(?:^|\s)--fix(?:\s|$)|lint:fix|prettier\s+--write|lint-staged/);
  assert.match(workflow, /run-quality-gates\.js/);
});
