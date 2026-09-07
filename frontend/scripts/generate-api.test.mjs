import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateApi } from './generate-api.mjs';

const document = {
  openapi: '3.0.3',
  info: { title: 'Contract test fixture', version: '1.0.0' },
  paths: {
    '/status': {
      get: {
        operationId: 'getStatus',
        responses: {
          200: {
            description: 'State snapshot',
            content: { 'application/json': { schema: {
              type: 'object', required: ['status'],
              properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
            } } },
          },
        },
      },
    },
  },
};
const previous = '// previous valid artifact\nexport interface paths { "/old": { get: unknown } }\n';

async function fixture(t, inputValue = document) {
  const directory = await mkdtemp(path.join(tmpdir(), 'booking-api-contract-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith('booking-api-contract-')) {
      throw new Error('Refusing cleanup outside the generated test fixture');
    }
    await rm(resolved, { recursive: true, force: true });
  });
  const input = path.join(directory, 'openapi.json');
  const output = path.join(directory, 'api.ts');
  await writeFile(input, typeof inputValue === 'string' ? inputValue : JSON.stringify(inputValue));
  await writeFile(output, previous);
  return { directory, input, output };
}

test('real generator produces nonempty operations and check detects drift without writing', async (t) => {
  const files = await fixture(t);
  const result = await generateApi(files);
  assert.equal(result.operationCount, 1);
  const generated = await readFile(files.output, 'utf8');
  assert.match(generated, /getStatus/);
  assert.match(generated, /"ACTIVE" \| "INACTIVE"/);
  await generateApi({ ...files, check: true });
  await writeFile(files.output, generated + '// stale\n');
  await assert.rejects(generateApi({ ...files, check: true }), /stale/);
  assert.equal(await readFile(files.output, 'utf8'), generated + '// stale\n');
  assert.deepEqual((await readdir(files.directory)).sort(), ['api.ts', 'openapi.json']);
});

for (const [label, value] of [
  ['invalid JSON', '{'],
  ['unsupported document', { openapi: '2.0', paths: document.paths }],
  ['missing paths', { ...document, paths: undefined }],
  ['empty paths', { ...document, paths: {} }],
  ['operationless paths', { ...document, paths: { '/status': {} } }],
  ['operation with no responses', { ...document, paths: { '/status': { get: {} } } }],
  ['empty responses', { ...document, paths: { '/status': { get: { responses: {} } } } }],
  ['success with no payload schema', { ...document, paths: { '/status': { get: { responses: { 200: { description: 'Missing shape' } } } } } }],
  ['empty DTO schema', { ...document, components: { schemas: { EmptyDto: { type: 'object', properties: {} } } } }],
]) {
  test(`${label} fails before generation and preserves existing output`, async (t) => {
    const files = await fixture(t, value);
    let generatorCalled = false;
    await assert.rejects(generateApi({ ...files, generate: async () => { generatorCalled = true; return ''; } }));
    assert.equal(generatorCalled, false);
    assert.equal(await readFile(files.output, 'utf8'), previous);
  });
}

test('network failure and non-success HTTP never overwrite an artifact', async (t) => {
  const files = await fixture(t);
  for (const fetchImpl of [
    async () => { throw new Error('connection refused'); },
    async () => ({ ok: false, status: 503 }),
  ]) {
    await assert.rejects(generateApi({ ...files, input: 'http://127.0.0.1:1/api-json', fetchImpl }));
    assert.equal(await readFile(files.output, 'utf8'), previous);
  }
});

test('generator exceptions and empty, malformed or incomplete paths output fail closed', async (t) => {
  const files = await fixture(t);
  const generators = [
    async () => { throw new Error('generator failed'); },
    async () => '',
    async () => 'export type paths = {}; export type components = {schemas:{}};',
    async () => 'export interface paths {',
    async () => 'export interface paths { "/status": { get?: never } }',
    async () => 'export interface paths { "/different": { get: unknown } }',
    async () => 'export interface paths { "/status": { get: any } }',
    async () => 'export interface paths { "/status": { get: unknown } }',
    async () => 'export interface paths { "/status": { get: {} } }',
    async () => 'export interface paths { "/status": { get: { responses: { 200: any } } } }',
    async () => 'export interface paths { "/status": { get: { responses: { 200: { headers: unknown } } } } }',
    async () => 'export interface paths { "/status": { get: { responses: { 200: { content: { "application/json": any } } } } } }',
  ];
  for (const generate of generators) {
    await assert.rejects(generateApi({ ...files, generate }));
    assert.equal(await readFile(files.output, 'utf8'), previous);
  }
});

test('failed first generation does not create an empty output', async (t) => {
  const files = await fixture(t, { ...document, paths: {} });
  const output = path.join(files.directory, 'new-api.ts');
  await assert.rejects(generateApi({ ...files, output }));
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('CLI exits nonzero for empty paths and preserves output', async (t) => {
  const files = await fixture(t, { ...document, paths: {} });
  const script = fileURLToPath(new URL('./generate-api.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--input', files.input, '--output', files.output], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /paths must not be empty/);
  assert.equal(await readFile(files.output, 'utf8'), previous);
});

test('real generator rejects an unresolved schema reference without replacing output', async (t) => {
  const invalidDocument = structuredClone(document);
  invalidDocument.paths['/status'].get.responses[200].content['application/json'].schema = {
    $ref: '#/components/schemas/DoesNotExist',
  };
  const files = await fixture(t, invalidDocument);
  const script = fileURLToPath(new URL('./generate-api.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--input', files.input, '--output', files.output], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /resolve.*\$ref/);
  assert.equal(await readFile(files.output, 'utf8'), previous);
});

test('an explicit 204 response is valid without inventing a response body', async (t) => {
  const noContentDocument = structuredClone(document);
  noContentDocument.paths['/status'].get.responses = { 204: { description: 'No content' } };
  const files = await fixture(t, noContentDocument);
  await generateApi(files);
  await generateApi({ ...files, check: true });
});
