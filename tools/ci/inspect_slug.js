const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET',
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fmt(label, obj) {
  const o = JSON.stringify(obj, null, 2);
  console.log(`\n=== ${label} ===\n${o}\n`);
}

(async () => {
  try {
    const slugs = process.argv.slice(2);
    if (slugs.length === 0) {
      console.error('Usage: node scripts/backend/inspect_slug.js <slug1> <slug2> ...');
      process.exit(1);
    }
    for (const slug of slugs) {
      const r = await get(`/agency/s/${slug}`);
      console.log(`slug ${slug} status:`, r.status);
      if (r.status >= 200 && r.status < 300) {
        const wrapped = JSON.parse(r.body);
        const data = wrapped?.data ?? wrapped;
        const summary = {
          slug,
          node_id: data?.id,
          service_id: data?.service?.id,
          service_title: data?.service?.title,
          display_price_from_api: data?.service?.sale_price ?? data?.service?.base_price,
          import_cost_for_next_agent: data?.importInfo?.costPrice,
          markup_type: data?.importInfo?.markupType,
          markup_value: data?.importInfo?.markupValue,
          parent_node_id: data?.importInfo?.parentNodeId,
          agent_nickname: data?.agent?.nickname,
        };
        fmt('Summary', summary);
      } else {
        console.log(r.body.slice(0, 400));
      }
    }
  } catch (e) {
    console.error('error:', e);
    process.exit(1);
  }
})();
