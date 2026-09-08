import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const OPENAPI_INGRESS_MANIFEST_VERSION = 1;

const ROUTE_KEYS = new Set([
  'controller_file',
  'handler',
  'surface',
  'method',
  'source_path',
  'openapi_path',
  'runtime_prefix',
  'runtime_path',
  'body_kind',
  'body_binding',
  'owner',
  'validation',
  'external_webhook',
]);
const ROOT_KEYS = new Set(['version', 'routes']);
const VALID_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_SURFACES = new Set(['app', 'test-only']);
const VALID_BODY_KINDS = new Set(['sdk-json', 'external-webhook', 'no-body']);
const VALID_BODY_BINDINGS = new Set(['whole', 'field', 'raw', 'none']);
const VALID_RUNTIME_PREFIXES = new Set(['api', 'none']);

export class IngressManifestValidationError extends Error {
  constructor(errors) {
    super(`Invalid OpenAPI ingress manifest:\n- ${errors.join('\n- ')}`);
    this.name = 'IngressManifestValidationError';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} has unknown key "${key}"`);
  }
}

function assertString(value, label, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`);
    return false;
  }
  return true;
}

function isRoutePath(path) {
  return typeof path === 'string' && /^\/(?:[A-Za-z0-9._-]+|:[A-Za-z][A-Za-z0-9_]*)?(?:\/(?:[A-Za-z0-9._-]+|:[A-Za-z][A-Za-z0-9_]*))*\/?$/.test(path);
}

export function sourcePathToOpenApiPath(sourcePath) {
  if (!isRoutePath(sourcePath)) {
    throw new TypeError(`Invalid source path "${sourcePath}"`);
  }
  return sourcePath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
}

export function sourcePathToRuntimePath(sourcePath, runtimePrefix) {
  if (!isRoutePath(sourcePath)) {
    throw new TypeError(`Invalid source path "${sourcePath}"`);
  }
  if (!VALID_RUNTIME_PREFIXES.has(runtimePrefix)) {
    throw new TypeError(`Invalid runtime prefix "${runtimePrefix}"`);
  }
  return runtimePrefix === 'api' ? `/api${sourcePath}` : sourcePath;
}

function assertStringList(value, label, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    errors.push(`${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`);
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (!assertString(item, `${label} item`, errors)) continue;
    if (seen.has(item)) errors.push(`${label} must not contain duplicate "${item}"`);
    seen.add(item);
  }
}

function assertValidation(route, label, errors) {
  const validation = route.validation;
  const allowed = new Set(['schema_requirement', 'expected_content_types', 'required_properties']);
  assertKnownKeys(validation, allowed, `${label}.validation`, errors);
  if (!isPlainObject(validation)) return;

  const kind = route.body_kind;
  const expectedRequirement =
    kind === 'sdk-json'
      ? 'non-empty-object'
      : kind === 'external-webhook'
        ? 'excluded-from-openapi'
        : 'no-request-body';
  if (validation.schema_requirement !== expectedRequirement) {
    errors.push(`${label}.validation.schema_requirement must be "${expectedRequirement}" for ${kind}`);
  }

  if (kind === 'sdk-json') {
    assertStringList(
      validation.expected_content_types,
      `${label}.validation.expected_content_types`,
      errors,
      { nonEmpty: true },
    );
    if (!Array.isArray(validation.expected_content_types) || !validation.expected_content_types.includes('application/json')) {
      errors.push(`${label}.validation.expected_content_types must include "application/json"`);
    }
    assertStringList(
      validation.required_properties,
      `${label}.validation.required_properties`,
      errors,
      { nonEmpty: true },
    );
  } else {
    if (!Array.isArray(validation.expected_content_types) || validation.expected_content_types.length !== 0) {
      errors.push(`${label}.validation.expected_content_types must be [] for ${kind}`);
    }
    if (!Array.isArray(validation.required_properties) || validation.required_properties.length !== 0) {
      errors.push(`${label}.validation.required_properties must be [] for ${kind}`);
    }
  }
}

function assertExternalWebhook(route, label, errors, now) {
  const value = route.external_webhook;
  const allowed = new Set(['classification', 'exposure', 'security_controls', 'review_due_on']);
  if (route.body_kind !== 'external-webhook') {
    if (value !== undefined) errors.push(`${label}.external_webhook is only allowed for external-webhook routes`);
    return;
  }
  assertKnownKeys(value, allowed, `${label}.external_webhook`, errors);
  if (!isPlainObject(value)) return;
  if (value.classification !== 'external-provider-webhook-adapter') {
    errors.push(`${label}.external_webhook.classification must be "external-provider-webhook-adapter"`);
  }
  assertString(value.exposure, `${label}.external_webhook.exposure`, errors);
  assertStringList(value.security_controls, `${label}.external_webhook.security_controls`, errors, { nonEmpty: true });
  if (typeof value.review_due_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.review_due_on)) {
    errors.push(`${label}.external_webhook.review_due_on must be an ISO date`);
  } else {
    const due = new Date(`${value.review_due_on}T00:00:00.000Z`);
    if (Number.isNaN(due.getTime()) || due < now) {
      errors.push(`${label}.external_webhook.review_due_on must not be expired`);
    }
  }
}

/**
 * Strictly validates the versioned declaration. It intentionally does not scan
 * controllers or boot Nest: later CI wiring will use this parser as its single
 * contract input and add source/runtime reconciliation on top of it.
 */
export function parseOpenApiIngressManifest(input, { now = new Date() } = {}) {
  const errors = [];
  assertKnownKeys(input, ROOT_KEYS, 'manifest', errors);
  if (!isPlainObject(input)) throw new IngressManifestValidationError(errors);
  if (input.version !== OPENAPI_INGRESS_MANIFEST_VERSION) {
    errors.push(`manifest.version must be ${OPENAPI_INGRESS_MANIFEST_VERSION}`);
  }
  if (!Array.isArray(input.routes) || input.routes.length === 0) {
    errors.push('manifest.routes must be a non-empty array');
  }

  const identities = new Set();
  for (const [index, route] of (Array.isArray(input.routes) ? input.routes : []).entries()) {
    const label = `manifest.routes[${index}]`;
    assertKnownKeys(route, ROUTE_KEYS, label, errors);
    if (!isPlainObject(route)) continue;
    for (const key of ROUTE_KEYS) {
      if (!(key in route) && key !== 'external_webhook') errors.push(`${label}.${key} is required`);
    }
    assertString(route.controller_file, `${label}.controller_file`, errors);
    if (typeof route.controller_file === 'string' && !/^src\/.+\.controller\.ts$/.test(route.controller_file)) {
      errors.push(`${label}.controller_file must be a controller path relative to backend`);
    }
    assertString(route.handler, `${label}.handler`, errors);
    if (typeof route.handler === 'string' && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(route.handler)) {
      errors.push(`${label}.handler must be a TypeScript identifier`);
    }
    if (!VALID_SURFACES.has(route.surface)) errors.push(`${label}.surface is invalid`);
    if (!VALID_METHODS.has(route.method)) errors.push(`${label}.method is invalid`);
    if (!VALID_BODY_KINDS.has(route.body_kind)) errors.push(`${label}.body_kind is invalid`);
    if (!VALID_BODY_BINDINGS.has(route.body_binding)) errors.push(`${label}.body_binding is invalid`);
    if (!VALID_RUNTIME_PREFIXES.has(route.runtime_prefix)) errors.push(`${label}.runtime_prefix is invalid`);
    assertString(route.owner, `${label}.owner`, errors);

    if (!isRoutePath(route.source_path)) {
      errors.push(`${label}.source_path is not a canonical Nest route path`);
    } else {
      const expectedOpenApi = sourcePathToOpenApiPath(route.source_path);
      if (route.openapi_path !== expectedOpenApi) {
        errors.push(`${label}.openapi_path must equal transformed source_path "${expectedOpenApi}"`);
      }
      if (VALID_RUNTIME_PREFIXES.has(route.runtime_prefix)) {
        const expectedRuntime = sourcePathToRuntimePath(route.source_path, route.runtime_prefix);
        if (route.runtime_path !== expectedRuntime) {
          errors.push(`${label}.runtime_path must equal transformed source_path "${expectedRuntime}"`);
        }
      }
      const identity = `${route.method} ${route.source_path}`;
      if (identities.has(identity)) errors.push(`${label} duplicates route "${identity}"`);
      identities.add(identity);
    }

    const allowedBinding =
      route.body_kind === 'sdk-json'
        ? new Set(['whole', 'field'])
        : route.body_kind === 'external-webhook'
          ? new Set(['whole', 'raw'])
          : new Set(['none']);
    if (!allowedBinding.has(route.body_binding)) {
      errors.push(`${label}.body_binding is incompatible with ${route.body_kind}`);
    }
    assertValidation(route, label, errors);
    assertExternalWebhook(route, label, errors, now);
  }
  if (errors.length > 0) throw new IngressManifestValidationError(errors);
  return structuredClone(input);
}

export function readOpenApiIngressManifest(path = resolve('backend/contracts/openapi-ingress-manifest.json'), options) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new IngressManifestValidationError([`cannot read manifest ${path}: ${error.message}`]);
  }
  return parseOpenApiIngressManifest(parsed, options);
}
