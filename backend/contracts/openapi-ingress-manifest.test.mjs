import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IngressManifestValidationError,
  parseOpenApiIngressManifest,
  readOpenApiIngressManifest,
  sourcePathToOpenApiPath,
  sourcePathToRuntimePath,
} from './openapi-ingress-manifest.mjs';

const now = new Date('2026-09-07T00:00:00.000Z');
const validRoute = {
  controller_file: 'src/domains/example/example.controller.ts',
  handler: 'create',
  surface: 'app',
  method: 'POST',
  source_path: '/example/:id',
  openapi_path: '/example/{id}',
  runtime_prefix: 'api',
  runtime_path: '/api/example/:id',
  body_kind: 'sdk-json',
  body_binding: 'whole',
  owner: 'example',
  validation: {
    schema_requirement: 'non-empty-object',
    expected_content_types: ['application/json'],
    required_properties: ['name'],
  },
};

function fixture(route = validRoute) {
  return { version: 1, routes: [structuredClone(route)] };
}

function errorFor(mutator) {
  const manifest = fixture();
  mutator(manifest);
  assert.throws(
    () => parseOpenApiIngressManifest(manifest, { now }),
    (error) => error instanceof IngressManifestValidationError,
  );
}

test('reads the checked-in production ingress manifest', () => {
  const manifest = readOpenApiIngressManifest(undefined, { now });
  assert.equal(manifest.version, 1);
  assert.ok(manifest.routes.length >= 50);
  assert.ok(manifest.routes.some((route) => route.source_path === '/telegram/webhook' && route.body_kind === 'external-webhook'));
  assert.ok(manifest.routes.some((route) => route.source_path === '/payment/notify/:channel' && route.body_kind === 'external-webhook'));
});

test('normalizes Nest parameters without guessing route structure', () => {
  assert.equal(sourcePathToOpenApiPath('/payment/notify/:channel'), '/payment/notify/{channel}');
  assert.equal(sourcePathToRuntimePath('/telegram/webhook', 'none'), '/telegram/webhook');
  assert.throws(() => sourcePathToOpenApiPath('missing-leading-slash'));
});

test('rejects unknown keys and duplicate mutating routes', () => {
  errorFor((manifest) => { manifest.routes[0].typo = true; });
  errorFor((manifest) => { manifest.routes.push(structuredClone(manifest.routes[0])); });
});

test('rejects invalid source-to-OpenAPI/runtime transforms', () => {
  errorFor((manifest) => { manifest.routes[0].openapi_path = '/example/:id'; });
  errorFor((manifest) => { manifest.routes[0].runtime_path = '/example/:id'; });
});

test('rejects sdk JSON entries without explicit schema property requirements', () => {
  errorFor((manifest) => { manifest.routes[0].validation.required_properties = []; });
  errorFor((manifest) => { delete manifest.routes[0].validation.schema_requirement; });
  errorFor((manifest) => { manifest.routes[0].validation.expected_content_types = []; });
});

test('rejects expired or under-specified external webhook declarations', () => {
  const external = structuredClone(validRoute);
  external.source_path = '/payment/notify/:channel';
  external.openapi_path = '/payment/notify/{channel}';
  external.runtime_path = '/api/payment/notify/:channel';
  external.body_kind = 'external-webhook';
  external.body_binding = 'whole';
  external.validation = {
    schema_requirement: 'excluded-from-openapi',
    expected_content_types: [],
    required_properties: [],
  };
  external.external_webhook = {
    classification: 'external-provider-webhook-adapter',
    exposure: 'provider-callback',
    security_controls: ['signature-verification'],
    review_due_on: '2026-12-07',
  };
  assert.doesNotThrow(() => parseOpenApiIngressManifest(fixture(external), { now }));
  errorFor((manifest) => {
    Object.assign(manifest.routes[0], external, {
      external_webhook: { ...external.external_webhook, review_due_on: '2026-09-06' },
    });
  });
  errorFor((manifest) => {
    Object.assign(manifest.routes[0], external, {
      external_webhook: { ...external.external_webhook, security_controls: [] },
    });
  });
});
