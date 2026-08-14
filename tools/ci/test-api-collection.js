const https = require('https');
const http = require('http');

function requestJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const mod = isHttps ? https : http;
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = mod.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const login = await requestJson('POST', 'http://localhost:3000/auth/login', {
      username: 'admin',
      password: 'admin123',
    });
    console.log('login status:', login.status);
    console.log('login body:', login.body.substring(0, 200));
    const parsed = JSON.parse(login.body);
    const token = parsed?.data?.access_token;
    if (!token) {
      console.error('No token, abort.');
      process.exit(1);
    }
    const auth = { Authorization: `Bearer ${token}` };
    const col = await requestJson('GET', 'http://localhost:3000/agency/collection', null, auth);
    console.log('collection status:', col.status);
    console.log('collection body:', col.body.substring(0, 200));
    const my = await requestJson('GET', 'http://localhost:3000/schedules/my', null, auth);
    console.log('my schedules status:', my.status);
    console.log('my schedules body:', my.body.substring(0, 200));
  } catch (e) {
    console.error('error:', e.message);
    process.exit(1);
  }
})();

