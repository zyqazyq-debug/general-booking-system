const http = require('http');

class TestHarness {
  constructor(baseUrl = process.env.API_BASE_URL || 'http://localhost:3001') {
    this.baseUrl = new URL(baseUrl);
    this.tokens = {}; // { username: token }
  }

  async request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const fullPath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
      const options = {
        hostname: this.baseUrl.hostname,
        port: this.baseUrl.port || 80,
        path: fullPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            if (buf) json = JSON.parse(buf);
          } catch (e) {
            // Not JSON
          }
          resolve({ status: res.statusCode, body: json || buf });
        });
      });

      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async register(username, password) {
    const res = await this.request('POST', '/auth/register', { username, password });
    if (res.status === 201 || res.status === 200) {
      console.log(`[Harness] Registered user: ${username}`);
      return res.body;
    }
    // Might already exist, ignore error if it's just "already exists"
    console.warn(`[Harness] Register user ${username} status: ${res.status}`);
    return res.body;
  }

  async login(username, password) {
    const res = await this.request('POST', '/auth/login', { username, password });
    if (res.status === 201 || res.status === 200) {
      const token = res.body?.data?.access_token || res.body?.access_token;
      if (token) {
        this.tokens[username] = token;
        console.log(`[Harness] Logged in as: ${username}`);
        return token;
      }
    }
    throw new Error(`Login failed for ${username}: ${JSON.stringify(res.body)}`);
  }

  getToken(username) {
    return this.tokens[username];
  }
}

module.exports = TestHarness;
