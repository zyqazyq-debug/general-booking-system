#!/usr/bin/env node
import { ContractError, EXIT, parseArgs } from './lib/contracts.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE = /^booking-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
export const TELEGRAM_PROXY_URL = 'socks5h://telegram-egress:1080';

export function verifyTelegramEgressReceipt(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== 'booking.telegram-egress-receipt/v1' || value.status !== 'pass' ||
      value.releaseId !== expected.releaseId || value.manifestDigest !== expected.manifestDigest ||
      value.egress?.imageDigest !== expected.imageDigest || value.egress?.network !== 'booking-preprod-telegram' ||
      value.egress?.proxyUrl !== TELEGRAM_PROXY_URL || value.transport?.target !== 'api.telegram.org' ||
      value.transport?.tokenFree !== true || !Number.isInteger(value.transport?.httpStatus) ||
      value.transport.httpStatus < 400 || value.transport.httpStatus > 499 || !Number.isFinite(Date.parse(value.observedAt))) {
    throw new ContractError('Telegram egress receipt is incomplete or does not bind the active release', EXIT.INGRESS);
  }
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (Object.keys(args).sort().join(',') !== 'egress-image-digest,manifest-digest,release-id' ||
      !RELEASE.test(args['release-id']) || !DIGEST.test(args['manifest-digest']) || !DIGEST.test(args['egress-image-digest'])) {
    throw new ContractError('Telegram egress receipt arguments are invalid', EXIT.IDENTITY);
  }
  let value;
  try { value = JSON.parse(process.env.BOOKING_TELEGRAM_EGRESS_RECEIPT || ''); }
  catch { throw new ContractError('Telegram egress receipt input is not JSON', EXIT.INGRESS); }
  const verified = verifyTelegramEgressReceipt(value, { releaseId: args['release-id'], manifestDigest: args['manifest-digest'], imageDigest: args['egress-image-digest'] });
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('/verify-telegram-egress.mjs')) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode || EXIT.INGRESS; }
}
