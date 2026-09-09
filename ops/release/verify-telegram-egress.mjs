#!/usr/bin/env node
import { ContractError, EXIT } from './lib/contracts.mjs';

export const TELEGRAM_PROXY_URL = 'socks5h://telegram-egress:1080';

export function verifyTelegramEgressReceipt(value, expected) {
  const observedAt = Date.parse(value?.observedAt);
  const expectedKeys = ['schema', 'status', 'operationId', 'releaseId', 'manifestDigest', 'egress', 'container', 'transport', 'observedAt'];
  const exact = value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expectedKeys].sort().join(',');
  const exactEgress = value?.egress && Object.keys(value.egress).sort().join(',') === ['imageDigest', 'network', 'proxyUrl'].sort().join(',');
  const exactContainer = value?.container && Object.keys(value.container).sort().join(',') === ['id', 'imageId', 'composeProject', 'composeService'].sort().join(',');
  const exactTransport = value?.transport && Object.keys(value.transport).sort().join(',') === ['scheme', 'target', 'path', 'tokenFree', 'httpStatus'].sort().join(',');
  const nowMs = expected.nowMs ?? Date.now();
  const maxAgeMs = expected.maxAgeMs ?? 120_000;
  if (!exact || !exactEgress || !exactContainer || !exactTransport ||
      value.schema !== 'booking.telegram-egress-receipt/v1' || value.status !== 'pass' ||
      value.operationId !== expected.operationId ||
      value.releaseId !== expected.releaseId || value.manifestDigest !== expected.manifestDigest ||
      value.egress?.imageDigest !== expected.imageDigest || value.egress?.network !== 'booking-preprod-telegram' ||
      value.egress?.proxyUrl !== TELEGRAM_PROXY_URL || value.transport?.scheme !== 'https' || value.transport?.target !== 'api.telegram.org' ||
      value.transport?.path !== '/botinvalid/getMe' ||
      value.transport?.tokenFree !== true || value.transport?.httpStatus !== 404 ||
      value.container?.id !== expected.containerId || value.container?.imageId !== expected.containerImageId ||
      value.container?.composeProject !== 'booking-preprod' || value.container?.composeService !== 'telegram-egress' ||
      !Number.isFinite(observedAt) || observedAt > nowMs + 5_000 || nowMs - observedAt > maxAgeMs) {
    throw new ContractError('Telegram egress receipt is incomplete or does not bind the active release', EXIT.INGRESS);
  }
  return value;
}

if (process.argv[1] && process.argv[1].endsWith('/verify-telegram-egress.mjs')) {
  process.stderr.write('Telegram egress verification is available only through the fenced executor live readback\n');
  process.exitCode = EXIT.INGRESS;
}
