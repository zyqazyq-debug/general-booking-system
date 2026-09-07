import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { IsolatedPreprodInputError, validateIsolatedPreprodInput } from './validate-isolated-preprod-input.mjs';

const fixturePath = new URL('../contracts/examples/isolated-preprod-input.fixture.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('accepts the non-secret isolated preprod fixture without network access', async () => {
  const input = await fixture();
  assert.doesNotThrow(() => validateIsolatedPreprodInput(input));
});

test('fails closed when a required G4 receipt path is absent', async () => {
  const input = await fixture();
  delete input.database.restoreReceiptPath;
  assert.throws(() => validateIsolatedPreprodInput(input), IsolatedPreprodInputError);
});

test('rejects production identity and an armed external change', async () => {
  const input = await fixture();
  input.environment.externalChangesAuthorized = true;
  assert.throws(() => validateIsolatedPreprodInput(input), /cannot authorize external changes/);

  const productionPath = await fixture();
  productionPath.nas.dataRoot = '/srv/fixture/booking-prod-data';
  assert.throws(() => validateIsolatedPreprodInput(productionPath), /isolated absolute path/);
});

test('requires a disabled inactive candidate with a matching edge upstream', async () => {
  const input = await fixture();
  input.lease.candidateWorkersEnabled = true;
  assert.throws(() => validateIsolatedPreprodInput(input), /workers must remain disabled/);

  const wrongUpstream = await fixture();
  wrongUpstream.edge.candidateUpstreamRef = 'gateway-blue';
  assert.throws(() => validateIsolatedPreprodInput(wrongUpstream), /candidate upstream/);
});

test('keeps database and rollback evidence independently accountable', async () => {
  const sharedReceipt = await fixture();
  sharedReceipt.database.restoreReceiptPath = sharedReceipt.database.backupReceiptPath;
  assert.throws(() => validateIsolatedPreprodInput(sharedReceipt), /receipt paths must be distinct/);

  const sameManifest = await fixture();
  sameManifest.rollback.previousReleaseManifestPath = sameManifest.release.manifestPath;
  assert.throws(() => validateIsolatedPreprodInput(sameManifest), /rollback manifest must differ/);
});
