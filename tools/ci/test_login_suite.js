
const http = require('http');

function testLogin(username, password, endpoint = '/api/auth/login') {
  const data = JSON.stringify(username === 'wechat' ? { openid: password } : { username, password });
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      console.log(`Test [${username}]: Status ${res.statusCode}`);
      console.log('Response:', responseData.substring(0, 200)); // Truncate long tokens
    });
  });

  req.on('error', (e) => {
    console.error(`Test [${username}] Error: ${e.message}`);
  });

  req.write(data);
  req.end();
}

console.log('Starting login tests...');
testLogin('admin', 'admin123');
setTimeout(() => testLogin('admin', 'wrongpass'), 500);
setTimeout(() => testLogin('wechat', 'demo', '/api/auth/wechat'), 1000);
