const http = require('http');

function requestJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
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
  const login = await requestJson('POST', 'http://localhost:3000/auth/login', {
    username: 'admin',
    password: 'admin123',
  });
  const token = JSON.parse(login.body)?.data?.access_token;
  if (!token) {
    console.error('login failed', login.status, login.body);
    process.exit(1);
  }
  const payload = {
    title: '测试服务',
    base_price: 99.9,
    duration_minutes: 45,
    deposit_points: 0,
    is_active: true,
    buffer_minutes: 15,
    rules: { start_hour: 9, end_hour: 18, weekdays: [1, 2, 3, 4, 5, 6, 7] },
  };
  const r = await requestJson(
    'POST',
    'http://localhost:3000/services',
    payload,
    { Authorization: `Bearer ${token}` },
  );
  console.log('create status:', r.status);
  console.log('create body:', r.body.substring(0, 300));
})(); 
