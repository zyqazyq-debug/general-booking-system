const TestHarness = require('./test_harness');

async function run() {
  const h = new TestHarness();
  const ts = Date.now().toString().slice(-6);
  const pName = `p_${ts}`;
  const aName = `a_${ts}`;
  const cName = `c_${ts}`;
  const pass = 'test123';

  console.log(`--- Starting Full Workflow Test (Suffix: ${ts}) ---`);

  try {
    const waitForOrderVisibility = async (token, orderId, maxAttempts = 10) => {
      for (let i = 0; i < maxAttempts; i++) {
        const res = await h.request('GET', '/order/my', null, token);
        const list = res.body?.data?.data || res.body?.data || [];
        const hit = Array.isArray(list)
          ? list.find((o) => o.id === orderId || o.order_id === orderId)
          : null;
        if (hit) return { list, hit };
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { list: [], hit: null };
    };

    // 1. Setup Users
    console.log('\n[1] Setting up users...');
    await h.register(pName, pass);
    await h.register(aName, pass);
    await h.register(cName, pass);

    const pToken = await h.login(pName, pass);
    const aToken = await h.login(aName, pass);
    const cToken = await h.login(cName, pass);

    // 2. Provider creates a service
    console.log('\n[2] Provider creating service...');
    const serviceRes = await h.request('POST', '/services', {
      title: 'Workflow Test Service',
      base_price: 100,
      deposit_points: 0,
      duration_minutes: 60,
      is_active: true,
      rules: { start_hour: 0, end_hour: 24, weekdays: [1,2,3,4,5,6,7] }
    }, pToken);
    console.log('Service creation response:', JSON.stringify(serviceRes.body));
    const serviceId = serviceRes.body?.data?.id || serviceRes.body?.id;
    if (!serviceId) throw new Error('Service creation failed');
    console.log(`Service created: ${serviceId}`);

    // 3. Provider creates a root AgencyNode as share entry
    console.log('\n[3] Provider creating share node...');
    const providerNodeRes = await h.request('POST', '/agency/collection', {
      serviceId,
      markup_type: 'PERCENT',
      markup_value: 0,
      alias: 'Provider Root Node'
    }, pToken);
    console.log('Share node response:', JSON.stringify(providerNodeRes.body));
    const providerNodeData = providerNodeRes.body?.data || providerNodeRes.body?.collection || providerNodeRes.body;
    const pSlug = providerNodeData?.share_slug;
    if (!pSlug) throw new Error('Share node creation failed');
    console.log(`Provider share slug: ${pSlug}`);

    // 4. Agent resolves and imports
    console.log('\n[4] Agent importing service...');
    const resolveRes = await h.request('GET', `/agency/s/${pSlug}`, null, aToken);
    console.log('Resolve response:', JSON.stringify(resolveRes.body));
    const resolveData = resolveRes.body?.data || resolveRes.body;
    const parentNodeId = resolveData?.importInfo?.parentNodeId;
    
    const importRes = await h.request('POST', '/agency/collection', {
      serviceId,
      parentNodeId,
      markup_type: 'FIXED',
      markup_value: 20,
      alias: 'Agent Markup Service'
    }, aToken);
    console.log('Import response:', JSON.stringify(importRes.body));
    const importData = importRes.body?.data || importRes.body?.collection || importRes.body;
    const aAgencyNodeId = importData?.id;
    const aSlug = importData?.share_slug;
    if (!aAgencyNodeId) throw new Error('Agent import failed');
    console.log(`Agent AgencyNode created: ${aAgencyNodeId}, Slug: ${aSlug}`);

    // 5. Customer resolves Agent's node
    console.log('\n[5] Customer resolving Agent node...');
    const nodeRes = await h.request('GET', `/agency/s/${aSlug}`, null, cToken);
    console.log('Node resolve response:', JSON.stringify(nodeRes.body));
    const nodeData = nodeRes.body?.data || nodeRes.body;
    if (nodeRes.status !== 200) throw new Error('Customer node resolution failed');
    console.log(`Resolved price: ${nodeData?.service?.sale_price ?? nodeData?.service?.base_price}`);

    // 6. Customer places order
    console.log('\n[6] Customer placing order...');
    const now = new Date();
    const start = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const orderRes = await h.request('POST', '/order', {
      service_id: serviceId,
      agency_node_id: aAgencyNodeId,
      start_time: start.toISOString(),
      end_time: end.toISOString()
    }, cToken);
    console.log('Order creation response:', JSON.stringify(orderRes.body));
    const orderData = orderRes.body?.data || orderRes.body;
    const orderId = orderData?.id;
    if (!orderId) throw new Error(`Order creation failed: ${JSON.stringify(orderRes.body)}`);
    console.log(`Order created: ${orderId}, Status: ${orderData?.status}`);

    // 7. Verify Data (Commissions)
    console.log('\n[7] Verifying data changes...');
    
    // Check Agent's orders/commissions
    const aVisible = await waitForOrderVisibility(aToken, orderId);
    const aCommissions = aVisible.list;
    console.log(`Agent has ${aCommissions.length} order records`);
    const myComm = aVisible.hit;
    if (myComm) {
      console.log(`Found order record for agent: Role=${myComm.role}, PriceSnapshot=${myComm.display_price_snapshot}`);
      if (myComm.commission_info) {
        console.log(`Commission Info: Cost=${myComm.commission_info.cost_price}, Markup=${myComm.commission_info.markup_amount}`);
      }
    } else {
      console.warn('Order record not found for agent in /order/my');
    }

    // Check Provider's orders/commissions
    const pVisible = await waitForOrderVisibility(pToken, orderId);
    const pCommissions = pVisible.list;
    console.log(`Provider has ${pCommissions.length} order records`);
    const pComm = pVisible.hit;
    if (pComm) {
       console.log(`Found order record for provider: Role=${pComm.role}`);
    }

    console.log('\n--- Full Workflow Test COMPLETED Successfully ---');

  } catch (err) {
    console.error('\n!!! Test Failed !!!');
    console.error(err);
    process.exit(1);
  }
}

run();
