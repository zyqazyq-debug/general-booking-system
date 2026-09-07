import {
  ContractError,
  EXIT,
  gateResult,
  safeBaseUrl,
  sha256,
  validateIngressContract,
  validateReleaseManifest,
} from '../../release/lib/contracts.mjs';

async function request(url, timeoutMs, expectedContentType) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'happybooking-release-gate/1' },
  });
  if (response.status !== 200) throw new Error(`HTTP_${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (expectedContentType && !contentType.toLowerCase().includes(expectedContentType)) {
    throw new Error('CONTENT_TYPE_MISMATCH');
  }
  return response;
}

async function readBody(response, maxBytes = 1024 * 1024) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('BODY_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function jsonCheck({ name, url, timeoutMs, verify }) {
  try {
    const response = await request(url, timeoutMs, 'application/json');
    const body = JSON.parse((await readBody(response)).toString('utf8'));
    verify(body);
    return { name, status: 'pass', code: 'HTTP_IDENTITY_OK' };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PROBE_FAILED';
    return { name, status: 'fail', code: code.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80) };
  }
}

function identityVerifier(manifest, slot, expectedStatus, requireManifestDigest = false) {
  return (body) => {
    if (!body || typeof body !== 'object') throw new Error('BODY_NOT_OBJECT');
    if (body.status !== expectedStatus) throw new Error('STATUS_MISMATCH');
    if (body.releaseId !== manifest.releaseId) throw new Error('RELEASE_ID_MISMATCH');
    if (body.slot !== slot) throw new Error('SLOT_MISMATCH');
    if (requireManifestDigest && body.manifestDigest !== sha256(manifest)) {
      throw new Error('MANIFEST_DIGEST_MISMATCH');
    }
  };
}

export async function probeSlot({ baseUrl, manifest, slot, timeoutMs = 5000 }) {
  validateReleaseManifest(manifest);
  if (!['blue', 'green'].includes(slot)) throw new ContractError('slot must be blue or green', EXIT.READINESS);
  const base = safeBaseUrl(baseUrl);
  const endpoint = (path) => new URL(path, `${base.href}/`).href;
  const checks = await Promise.all([
    jsonCheck({
      name: 'liveness',
      url: endpoint(manifest.probes.live),
      timeoutMs,
      verify: identityVerifier(manifest, slot, 'up'),
    }),
    jsonCheck({
      name: 'readiness',
      url: endpoint(manifest.probes.ready),
      timeoutMs,
      verify: identityVerifier(manifest, slot, 'ready'),
    }),
    jsonCheck({
      name: 'version',
      url: endpoint(manifest.probes.version),
      timeoutMs,
      verify: identityVerifier(manifest, slot, 'up', true),
    }),
  ]);
  return gateResult({ gate: 'slot-ready', releaseId: manifest.releaseId, slot, checks });
}

export async function probeIngress({ baseUrl, manifest, ingress, timeoutMs = 8000 }) {
  validateReleaseManifest(manifest);
  validateIngressContract(ingress);
  const base = safeBaseUrl(baseUrl);
  if (base.protocol !== 'https:') throw new ContractError('public ingress probe requires HTTPS', EXIT.INGRESS);
  if (base.hostname !== ingress.hostname) throw new ContractError('public URL hostname does not match ingress contract', EXIT.INGRESS);
  const endpoint = (path) => new URL(path, `${base.href}/`).href;
  const slot = null;
  const checks = [];
  try {
    const response = await request(endpoint('/'), timeoutMs, 'text/html');
    await readBody(response);
    checks.push({ name: 'frontend-root', status: 'pass', code: 'HTML_OK' });
  } catch (error) {
    checks.push({ name: 'frontend-root', status: 'fail', code: error instanceof Error ? error.message : 'PROBE_FAILED' });
  }
  checks.push(await jsonCheck({
    name: 'ingress-readiness',
    url: endpoint(ingress.healthPath),
    timeoutMs,
    verify: (body) => {
      if (body?.status !== 'ready' || body?.releaseId !== manifest.releaseId) throw new Error('INGRESS_READY_IDENTITY_MISMATCH');
    },
  }));
  checks.push(await jsonCheck({
    name: 'ingress-version',
    url: endpoint(ingress.versionPath),
    timeoutMs,
    verify: (body) => {
      if (body?.releaseId !== manifest.releaseId || body?.manifestDigest !== sha256(manifest)) {
        throw new Error('INGRESS_VERSION_IDENTITY_MISMATCH');
      }
    },
  }));
  checks.push({
    name: 'telegram-webhook-route-contract',
    status: ingress.webhookPath === '/telegram/webhook' ? 'pass' : 'fail',
    code: 'DECLARATION_ONLY_NO_WEBHOOK_REQUEST',
  });
  return gateResult({ gate: 'public-ingress', releaseId: manifest.releaseId, slot, checks });
}
