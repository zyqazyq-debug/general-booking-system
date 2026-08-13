const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const viteConfigPath = path.join(rootDir, 'frontend', 'vite.config.ts');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const print = {
  title: (text) => console.log(`${colors.cyan}${text}${colors.reset}`),
  ok: (text) => console.log(`${colors.green}PASS${colors.reset} ${text}`),
  fail: (text) => console.log(`${colors.red}FAIL${colors.reset} ${text}`),
  warn: (text) => console.log(`${colors.yellow}WARN${colors.reset} ${text}`),
};

const normalizeBase = (url) => String(url || '').replace(/\/+$/, '');

const parseProxyTarget = () => {
  const content = fs.readFileSync(viteConfigPath, 'utf8');
  const match = content.match(/\/api'\s*:\s*\{[\s\S]*?target\s*:\s*['"`]([^'"`]+)['"`]/);
  if (!match?.[1]) {
    throw new Error(`无法从 ${viteConfigPath} 解析 /api 代理 target`);
  }
  return normalizeBase(match[1]);
};

const tryJson = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const checkGet = async (name, url, expectedStatus = [200]) => {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'GET' });
    const body = await tryJson(res);
    const ms = Date.now() - started;
    const ok = expectedStatus.includes(res.status);
    return { name, url, ok, status: res.status, ms, body };
  } catch (error) {
    return { name, url, ok: false, status: 0, ms: Date.now() - started, error: String(error) };
  }
};

const checkPost = async (name, url, payload, expectedStatus = [200, 201]) => {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await tryJson(res);
    const ms = Date.now() - started;
    const ok = expectedStatus.includes(res.status);
    return { name, url, ok, status: res.status, ms, body };
  } catch (error) {
    return { name, url, ok: false, status: 0, ms: Date.now() - started, error: String(error) };
  }
};

const line = (r) => `${r.name} | status=${r.status} | ${r.ms}ms | ${r.url}`;

const isBackendHealthSoftPass = (r) => {
  if (r.name !== 'backend /health') return false;
  if (r.status !== 503 || !r.body || typeof r.body !== 'object') return false;
  const info = r.body?.data?.info || {};
  const dbUp = info?.database?.status === 'up';
  const heapUp = info?.memory_heap?.status === 'up';
  const rssUp = info?.memory_rss?.status === 'up';
  const telegramDown = r.body?.data?.error?.telegram?.status === 'down';
  return dbUp && heapUp && rssUp && telegramDown;
};

const probeFrontend = async (base) => {
  try {
    const res = await fetch(`${base}/`, { method: 'GET' });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
};

const resolveFrontendBase = async () => {
  if (process.env.FRONTEND_BASE_URL) {
    return normalizeBase(process.env.FRONTEND_BASE_URL);
  }
  const candidates = ['http://localhost:8443', 'http://localhost:5180', 'http://localhost:5174'];
  for (const candidate of candidates) {
    if (await probeFrontend(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
};

const run = async () => {
  print.title('联调预检开始');
  const proxyTarget = parseProxyTarget();
  const frontendBase = await resolveFrontendBase();
  const backendBase = normalizeBase(process.env.BACKEND_BASE_URL || proxyTarget);

  console.log(`frontend=${frontendBase}`);
  console.log(`proxyTarget=${proxyTarget}`);
  console.log(`backend=${backendBase}`);
  if (!process.env.FRONTEND_BASE_URL) {
    print.warn('未指定 FRONTEND_BASE_URL，已自动探测前端地址');
  }

  const checks = [
    await checkGet('backend /health', `${backendBase}/health`, [200]),
    await checkGet(
      'frontend proxy /api/share-link/resolve',
      `${frontendBase}/api/share-link/resolve?token=PRECHECK_PING`,
      [200, 400, 404],
    ),
    await checkPost(
      'frontend proxy /api/debug/log',
      `${frontendBase}/api/debug/log`,
      { event: 'PRECHECK_PING', from: 'scripts/check_dev_preflight.js', ts: Date.now() },
      [200, 201],
    ),
  ];

  for (const r of checks) {
    if (!r.ok && isBackendHealthSoftPass(r)) {
      r.ok = true;
      print.warn(`backend /health soft-pass: core deps up, telegram down`);
    }
    if (r.ok) {
      print.ok(line(r));
    } else {
      print.fail(line(r));
      if (r.error) {
        print.warn(`error=${r.error}`);
      } else {
        print.warn(`body=${typeof r.body === 'string' ? r.body.slice(0, 220) : JSON.stringify(r.body).slice(0, 220)}`);
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    print.fail(`联调预检失败：${failed.length} 项未通过`);
    process.exitCode = 1;
    return;
  }

  print.ok('联调预检通过');
};

run().catch((error) => {
  print.fail(`联调预检异常：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
