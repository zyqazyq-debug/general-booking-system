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

function unwrap(body) {
  try {
    const w = JSON.parse(body);
    return w?.data ?? w;
  } catch {
    return null;
  }
}

(async () => {
  const [slugA, slugB] = process.argv.slice(2);
  if (!slugA || !slugB) {
    console.error('Usage: node scripts/backend/inspect_slug_chain.js <slugA> <slugB>');
    process.exit(1);
  }
  // Resolve slugs (public)
  const a = unwrap(
    (await requestJson('GET', `http://localhost:3000/agency/s/${slugA}`)).body,
  );
  const b = unwrap(
    (await requestJson('GET', `http://localhost:3000/agency/s/${slugB}`)).body,
  );
  if (!a || !b) {
    console.error('Failed to resolve one of the slugs');
    process.exit(1);
  }
  const aNodeId = a?.importInfo?.parentNodeId;
  const bNodeId = b?.importInfo?.parentNodeId;
  // Login for secured endpoints
  const login = await requestJson('POST', 'http://localhost:3000/auth/login', {
    username: 'admin',
    password: 'admin123',
  });
  const token = unwrap(login.body)?.access_token || unwrap(login.body)?.data?.access_token;
  if (!token) {
    console.error('Login failed');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };
  // Fetch node details
  const aNode = unwrap((await requestJson('GET', `http://localhost:3000/agency/nodes/${aNodeId}`, null, auth)).body);
  const bNode = unwrap((await requestJson('GET', `http://localhost:3000/agency/nodes/${bNodeId}`, null, auth)).body);
  const result = {
    A: {
      slug: slugA,
      node_id: aNode?.id,
      parent_node_id: aNode?.parent_node_id,
      service_id: aNode?.service_id,
      cache_cost_price: aNode?.cache_cost_price,
      cache_total_price: aNode?.cache_total_price,
      markup_type: aNode?.markup_type,
      markup_value: aNode?.markup_value,
    },
    B: {
      slug: slugB,
      node_id: bNode?.id,
      parent_node_id: bNode?.parent_node_id,
      service_id: bNode?.service_id,
      cache_cost_price: bNode?.cache_cost_price,
      cache_total_price: bNode?.cache_total_price,
      markup_type: bNode?.markup_type,
      markup_value: bNode?.markup_value,
    },
    relation: bNode?.parent_node_id === aNode?.id ? 'B is child of A' : 'No direct parent-child',
  };
  console.log(JSON.stringify(result, null, 2));
})(); 
