#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { ContractError, EXIT, gateResult, parseArgs, readJsonFile, validateIngressContract } from './lib/contracts.mjs';

async function text(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new ContractError(`cannot read ${label}: ${path}`);
  }
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) throw new ContractError(message);
}

function rejectPattern(source, pattern, message) {
  if (pattern.test(source)) throw new ContractError(message);
}

export async function validateComposeContracts(paths) {
  const [dev, data, edge, release, network] = await Promise.all([
    text(paths.dev, 'dev compose'),
    text(paths.data, 'data compose'),
    text(paths.edge, 'edge compose'),
    text(paths.release, 'release compose'),
    text(paths.network, 'edge network template'),
  ]);
  const ingress = validateIngressContract(await readJsonFile(paths.ingress));
  const prod = `${data}\n${edge}\n${release}`;

  if (!paths.edgeBindAddress || isIP(paths.edgeBindAddress) === 0 || ['0.0.0.0', '::'].includes(paths.edgeBindAddress)) {
    throw new ContractError('edge bind address must be an explicit non-wildcard IP', EXIT.INGRESS);
  }
  const cidrMatch = String(paths.trustedProxyCidr || '').match(/^([^/]+)\/([0-9]{1,3})$/);
  const cidrVersion = cidrMatch ? isIP(cidrMatch[1]) : 0;
  const prefix = cidrMatch ? Number(cidrMatch[2]) : -1;
  if (!cidrVersion || prefix < 1 || prefix > (cidrVersion === 4 ? 32 : 128)) {
    throw new ContractError('trusted proxy CIDR must be explicit and cannot trust the entire address space', EXIT.INGRESS);
  }

  requirePattern(dev, /profiles:\s*\["dev"\]/, 'dev services must use the dev profile');
  requirePattern(dev, /\.\.\/\.\.\/backend:\/workspace\/backend/, 'dev backend source bind is missing');
  requirePattern(dev, /\.\.\/\.\.\/frontend:\/workspace\/frontend/, 'dev frontend source bind is missing');
  requirePattern(dev, /booking_dev_backend_modules/, 'dev backend dependency volume is missing');
  requirePattern(dev, /booking_dev_frontend_modules/, 'dev frontend dependency volume is missing');
  requirePattern(dev, /BOOKING_DEV_USE_POLLING/, 'dev polling control is missing');
  rejectPattern(dev, /\.env\.production|booking-prod|TELEGRAM_BOT_TOKEN\s*:/i, 'dev compose references production identity or inline token');

  rejectPattern(prod, /(^|:)latest(?:\s|$)/m, 'production compose must not use latest tags');
  rejectPattern(prod, /docker\s+cp|CHOKIDAR|WATCHPACK|\.\.\/\.\.\/(backend|frontend):/i, 'production compose contains mutable-code or watcher behavior');
  const prodImages = prod.match(/^\s*image:\s*.+$/gm) || [];
  if (prodImages.length < 4) throw new ContractError('production compose image declarations are incomplete');
  for (const imageLine of prodImages) {
    requirePattern(imageLine, /image:\s*\$\{[^\n}]*IMAGE[^\n}]*\}@\$\{[^\n}]*DIGEST[^\n}]*\}/, 'every production image must be repository plus required digest');
  }
  rejectPattern(data, /^\s+ports:\s*$/m, 'data services must not publish host ports');
  rejectPattern(release, /^\s+ports:\s*$/m, 'release slots must not publish host ports');
  requirePattern(edge, /BOOKING_EDGE_BIND_ADDRESS:\?/, 'edge bind address must be explicit and fail closed');
  rejectPattern(edge, /0\.0\.0\.0|:::/, 'edge compose must not default to a wildcard bind');
  requirePattern(edge, /BOOKING_TRUSTED_PROXY_CIDR:\?/, 'trusted proxy CIDR must be explicit');
  requirePattern(release, /BOOKING_WORKERS_ENABLED:\s*\$\{BOOKING_(BLUE|GREEN)_WORKERS_ENABLED:-false\}/, 'candidate workers must default to disabled');
  requirePattern(release, /TELEGRAM_WEBHOOK_SECRET_TOKEN_FILE/, 'webhook secret file handoff is missing');
  requirePattern(release, /BOOKING_BACKEND_UPSTREAM:\s*backend-blue:3001/, 'blue gateway backend upstream is missing');
  requirePattern(release, /BOOKING_BACKEND_UPSTREAM:\s*backend-green:3001/, 'green gateway backend upstream is missing');

  requirePattern(network, /location\s*=\s*\/telegram\/webhook\s*\{/, 'root Telegram webhook route is missing');
  rejectPattern(network, /\/api\/telegram\/webhook/, 'Telegram webhook must not be routed below /api');
  if (ingress.webhookPath !== '/telegram/webhook') throw new ContractError('ingress webhook route is invalid', EXIT.INGRESS);

  return true;
}

async function main() {
  let exitCode = EXIT.PASS;
  let output;
  try {
    const args = parseArgs(process.argv.slice(2));
    for (const key of ['dev', 'data', 'edge', 'release', 'network', 'ingress', 'edge-bind-address', 'trusted-proxy-cidr']) {
      if (!args[key]) throw new ContractError(`--${key} is required`);
    }
    await validateComposeContracts({
      ...args,
      edgeBindAddress: args['edge-bind-address'],
      trustedProxyCidr: args['trusted-proxy-cidr'],
    });
    output = gateResult({
      gate: 'compose-contract',
      checks: [{ name: 'compose-and-ingress', status: 'pass', code: 'COMPOSE_CONTRACT_VALID' }],
    });
  } catch (error) {
    const failure = error instanceof ContractError ? error : new ContractError('unexpected compose validation failure');
    exitCode = failure.exitCode;
    output = gateResult({
      gate: 'compose-contract',
      checks: [{ name: 'compose-and-ingress', status: 'fail', code: 'COMPOSE_CONTRACT_INVALID', detail: failure.message }],
    });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
