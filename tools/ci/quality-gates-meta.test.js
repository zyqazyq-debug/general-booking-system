const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { gates, runGate } = require('./run-quality-gates');

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

test('Windows invokes npm.cmd through cmd.exe while Node gates remain direct', () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  const npmGate = gates.find((gate) => gate.command === 'npm.cmd');
  const nodeGate = gates.find((gate) => gate.command === process.execPath);

  assert.ok(npmGate, 'expected an npm gate');
  assert.ok(nodeGate, 'expected a Node gate');
  const commandShell = 'C:\\Windows\\System32\\cmd.exe';
  const originalComSpec = process.env.ComSpec;
  process.env.ComSpec = commandShell;
  try {
    runGate(npmGate, { platform: 'win32', spawn });
  } finally {
    if (originalComSpec === undefined) {
      delete process.env.ComSpec;
    } else {
      process.env.ComSpec = originalComSpec;
    }
  }
  runGate(nodeGate, { platform: 'win32', spawn });

  assert.equal(calls[0].command, commandShell);
  assert.deepEqual(calls[0].args.slice(0, 4), ['/d', '/s', '/c', 'npm.cmd']);
  assert.deepEqual(calls[0].args.slice(4), npmGate.args);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[1].command, nodeGate.command);
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[0].options.cwd, repoRoot);
  assert.equal(calls[1].options.cwd, repoRoot);
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
