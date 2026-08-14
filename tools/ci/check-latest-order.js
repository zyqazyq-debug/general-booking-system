require('dotenv').config()
const { Client } = require('pg')

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || process.env.POSTGRES_HOST,
    port: Number(process.env.DB_PORT || process.env.POSTGRES_PORT),
    user: process.env.DB_USERNAME || process.env.POSTGRES_USER,
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.DB_DATABASE || process.env.POSTGRES_DB,
  })
  await client.connect()

  const orderNo = process.argv[2]
  const latestOrderRes = orderNo
    ? await client.query(
        `SELECT o.id, o.order_no, o.status, o.frozen_points, o.consumer_id, o.owner_id, o.service_id, o.agency_node_id, o.created_at, o.updated_at,
                s.owner_id AS service_owner_id,
                n.agent_id AS node_agent_id
         FROM orders o
         LEFT JOIN services s ON s.id = o.service_id
         LEFT JOIN agency_nodes n ON n.id = o.agency_node_id
         WHERE o.order_no = $1
         LIMIT 1`,
        [orderNo],
      )
    : await client.query(
        `SELECT o.id, o.order_no, o.status, o.frozen_points, o.consumer_id, o.owner_id, o.service_id, o.agency_node_id, o.created_at, o.updated_at,
                s.owner_id AS service_owner_id,
                n.agent_id AS node_agent_id
         FROM orders o
         LEFT JOIN services s ON s.id = o.service_id
         LEFT JOIN agency_nodes n ON n.id = o.agency_node_id
         ORDER BY o.created_at DESC
         LIMIT 1`,
      )
  const latest = latestOrderRes.rows[0]
  console.log('order', latest)

  if (!latest) {
    await client.end()
    return
  }

  const userRes = await client.query(
    `SELECT id, credit_balance, frozen_credit, updated_at
     FROM "user"
     WHERE id = $1`,
    [latest.consumer_id],
  )
  console.log('consumer_credit', userRes.rows[0] || null)

  const reservedSumRes = await client.query(
    `SELECT COALESCE(SUM(frozen_points), 0) AS reserved_total
     FROM orders
     WHERE consumer_id = $1 AND status = 'RESERVED'`,
    [latest.consumer_id],
  )
  console.log('consumer_reserved_total', reservedSumRes.rows[0])

  console.log('identity_check', {
    consumer_eq_order_owner: latest.consumer_id === latest.owner_id,
    consumer_eq_service_owner: latest.consumer_id === latest.service_owner_id,
    consumer_eq_agent: latest.consumer_id === latest.node_agent_id,
  })

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
