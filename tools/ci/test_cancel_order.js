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
  const auth = { Authorization: `Bearer ${token}` };
  let schedules = await requestJson('GET', 'http://localhost:3000/schedules/my', null, auth);
  let sid = JSON.parse(schedules.body)?.data?.[0]?.id;
  if (!sid) {
    const create = await requestJson('POST', 'http://localhost:3000/schedules', {
      title: '取消测试服务',
      base_price: 10,
      duration_minutes: 30,
      deposit_points: 0,
      is_active: true,
      buffer_minutes: 0,
      rules: { start_hour: 0, end_hour: 24, weekdays: [1,2,3,4,5,6,7] },
    }, auth);
    sid = JSON.parse(create.body)?.data?.id;
  }
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const orderRes = await requestJson('POST', 'http://localhost:3000/order', {
    schedule_id: sid,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  }, auth);
  console.log('create order:', orderRes.status, orderRes.body.substring(0, 160));
  const oid = JSON.parse(orderRes.body)?.id || JSON.parse(orderRes.body)?.data?.id;
  const cancelRes = await requestJson('POST', `http://localhost:3000/order/${oid}/cancel`, null, auth);
  console.log('cancel:', cancelRes.status, cancelRes.body.substring(0, 200));
})(); 
