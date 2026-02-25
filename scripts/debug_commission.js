const { DataSource } = require('typeorm');
const path = require('path');

async function run() {
  const AppDataSource = new DataSource({
    type: 'sqlite',
    database: path.join(__dirname, '../backend/database.sqlite'),
    synchronize: false,
    entities: [
        require('../backend/src/agency/entities/commission-record.entity').CommissionRecord,
        require('../backend/src/order/entities/order.entity').Order,
        require('../backend/src/users/entities/user.entity').User,
        require('../backend/src/schedules/entities/schedule.entity').Schedule,
        require('../backend/src/product-listing/entities/product-listing.entity').ProductListing,
        require('../backend/src/agent/entities/agent-link.entity').AgentLink,
        require('../backend/src/agency/entities/agency-node.entity').AgencyNode
    ],
  });

  await AppDataSource.initialize();
  console.log('Database connected');

  const records = await AppDataSource.getRepository('CommissionRecord').find({
    relations: ['order', 'order.schedule', 'order.consumer'],
    order: { created_at: 'DESC' },
    take: 10
  });

  console.log('Found records:', records.length);
  records.forEach(r => {
    console.log(`Record ID: ${r.id}, Order: ${r.order?.id}, Agent: ${r.agent_id}, Role: ${r.role}, Amount: ${r.markup_amount}`);
  });
  
  // Also verify user's ID to simulate check
  const users = await AppDataSource.getRepository('User').find({ take: 1 });
  if (users.length > 0) {
      const userId = users[0].id;
      console.log(`Checking for User ID: ${userId}`);
      const myRecords = records.filter(r => r.agent_id === userId);
      console.log(`My records found: ${myRecords.length}`);
  }

  await AppDataSource.destroy();
}

run().catch(console.error);
