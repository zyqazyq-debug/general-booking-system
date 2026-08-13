/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { config as loadDotenv } from 'dotenv';
// Set env vars before importing AppModule to ensure validation passes
loadDotenv();
process.env.JWT_SECRET = 'test_secret_for_e2e_testing_only';
process.env.JWT_SECRET1 = 'test_secret_for_e2e_testing_only';
process.env.JWT_SECRET_ACTIVE_INDEX = '1';
process.env.USE_POSTGRES = 'false';
process.env.TYPEORM_SYNCHRONIZE = 'true';
process.env.NODE_ENV = 'test';
process.env.H5_URL = 'http://localhost:8080';
process.env.TELEGRAM_BOT_TOKEN = 'DUMMY'; // Skip Telegram connection check
process.env.TELEGRAM_WEBAPP_URL = 'http://localhost:3000';

const isPostgres = process.env.USE_POSTGRES === 'true';

if (isPostgres) {
  process.env.POSTGRES_HOST =
    process.env.TEST_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? '';
  process.env.POSTGRES_PORT =
    process.env.TEST_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? '';
  process.env.POSTGRES_USER =
    process.env.TEST_POSTGRES_USER ?? process.env.POSTGRES_USER ?? '';
  process.env.POSTGRES_PASSWORD =
    process.env.TEST_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? '';
  process.env.POSTGRES_DB =
    process.env.TEST_POSTGRES_DB ?? process.env.POSTGRES_DB ?? '';

  const requiredPgEnvKeys = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
  ] as const;

  const missingPgEnvKeys = requiredPgEnvKeys.filter((key) => !process.env[key]);
  if (missingPgEnvKeys.length > 0) {
    throw new Error(
      `Missing Postgres e2e env: ${missingPgEnvKeys.join(', ')}. Set TEST_POSTGRES_* or POSTGRES_* before running.`,
    );
  }

  const e2eDbName = process.env.POSTGRES_DB ?? '';
  if (!/(test|e2e)/i.test(e2eDbName)) {
    throw new Error(
      `Unsafe e2e database name "${e2eDbName}". Please use a dedicated test database.`,
    );
  }
}

import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { User } from '../src/domains/users/entities/user.entity';

type AuthRegisterBody = { id?: string; user?: { id: string } };
type AuthLoginBody = { access_token: string };
type ServiceBody = { id: string; base_price: number | string };
type CollectionBody = {
  id: string;
  parent_node_id?: string;
  markup_amount: number | string;
  cache_total_price: number | string;
  cache_cost_price?: number | string;
};
type CreditSummaryBody = { available_credit: number | string };
type OrderBody = {
  id: string;
  display_price_snapshot: number | string;
  service_snapshot: { sale_price: number | string };
};

describe('Booking Flow (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // Store tokens and IDs
  let providerToken: string;
  let resellerToken: string;
  let resellerId: string;
  let serviceId: string;
  let nodeAId: string;
  let nodeBId: string;
  const api = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get<DataSource>(DataSource);

    const dbType = dataSource.options.type;
    if (dbType === 'postgres') {
      const entities = dataSource.entityMetadatas;
      const tableNames = entities.map((entity) => `"${entity.tableName}"`);
      if (tableNames.length > 0) {
        await dataSource.query(
          `TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`,
        );
      }
    } else {
      const entities = dataSource.entityMetadatas;
      for (const entity of entities) {
        const repository = dataSource.getRepository(entity.name);
        await repository.query('PRAGMA foreign_keys = OFF');
        await repository.query(`DELETE FROM "${entity.tableName}"`);
        await repository.query('PRAGMA foreign_keys = ON');
      }
    }
  }, 30000); // Increase timeout to 30s

  afterAll(async () => {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Bot is not running')) {
          throw error;
        }
      }
    }
  });

  describe('1. Provider Setup (User A)', () => {
    it('should register provider', async () => {
      const res = await api()
        .post('/auth/register')
        .send({
          username: 'provider_a',
          password: 'password123',
          email: 'provider@test.com',
        })
        .expect(201);

      const body = res.body as AuthRegisterBody;
      const createdProviderId = body.user ? body.user.id : body.id;
      expect(createdProviderId).toBeDefined();
    });

    it('should login provider', async () => {
      const res = await api()
        .post('/auth/login')
        .send({
          username: 'provider_a',
          password: 'password123',
        })
        .expect(201);

      const body = res.body as AuthLoginBody;
      providerToken = body.access_token;
      expect(providerToken).toBeDefined();
    });

    it('should create a service', async () => {
      const res = await api()
        .post('/services')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          title: 'E2E Test Service',
          description: 'A service for E2E testing',
          base_price: 100,
          duration_minutes: 60,
          deposit_points: 10,
          is_active: true,
          rules: {
            start_hour: 9,
            end_hour: 17,
            weekdays: [1, 2, 3, 4, 5, 6, 7], // All days
          },
        })
        .expect(201);

      const body = res.body as ServiceBody;
      serviceId = body.id;
      expect(serviceId).toBeDefined();
      expect(Number(body.base_price)).toBe(100);
    });

    it('should create a collection (Agency Node A) with 10% markup', async () => {
      const res = await api()
        .post('/agency/collection')
        .set('Authorization', `Bearer ${providerToken}`)
        .send({
          serviceId: serviceId,
          markup_type: 'PERCENT',
          markup_value: 10,
          alias: 'Provider Collection',
        })
        .expect(201);

      // Response might be { node: ... } or just node depending on controller
      // Controller returns: { collection: collectionResult } or just collectionResult
      // Based on code: if authPayload is null (which it is for logged in user), it returns collectionResult directly.

      const body = res.body as CollectionBody;
      nodeAId = body.id;
      expect(nodeAId).toBeDefined();
      expect(Number(body.markup_amount)).toBe(10);
      expect(Number(body.cache_total_price)).toBe(110);
    });

    it('should return availability=off when service is deactivated', async () => {
      const dateStr = '2030-01-01';

      const beforeRes = await api()
        .get(`/agency/collection/availability?date=${dateStr}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      const beforeBody = beforeRes.body as Record<string, string>;
      expect(beforeBody[nodeAId]).toBeDefined();
      expect(beforeBody[nodeAId]).not.toBe('off');

      await api()
        .patch(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ is_active: false })
        .expect(200);

      const afterRes = await api()
        .get(`/agency/collection/availability?date=${dateStr}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      const afterBody = afterRes.body as Record<string, string>;
      expect(afterBody[nodeAId]).toBe('off');

      await api()
        .get(`/services/${serviceId}/slots?date=${dateStr}`)
        .expect(400);

      await api()
        .patch(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ is_active: true })
        .expect(200);
    });
  });

  describe('2. Reseller Setup (User B)', () => {
    it('should register reseller', async () => {
      const res = await api()
        .post('/auth/register')
        .send({
          username: 'reseller_b',
          password: 'password123',
          email: 'reseller@test.com',
        })
        .expect(201);

      const body = res.body as AuthRegisterBody;
      resellerId = body.user ? body.user.id : (body.id ?? '');
      expect(resellerId).toBeDefined();
    });

    it('should login reseller', async () => {
      const res = await api()
        .post('/auth/login')
        .send({
          username: 'reseller_b',
          password: 'password123',
        })
        .expect(201);

      const body = res.body as AuthLoginBody;
      resellerToken = body.access_token;
      expect(resellerToken).toBeDefined();
    });

    let nodeASlug = '';

    it('should get Share Link for Node A (Test Case A)', async () => {
      const nodeARes = await api()
        .get(`/agency/nodes/${nodeAId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);

      const nodeABody = nodeARes.body as { share_slug?: string };
      nodeASlug = nodeABody.share_slug || '';
      expect(nodeASlug).toBeDefined();
    });

    it('should import Node A as Node B using share slug (Test Case B)', async () => {
      // Simulate frontend calling import endpoint with slug (via Telegram app service simulation)
      // Wait, Telegram uses internal app service. The frontend uses `POST /agency/collection` with `listingIds` or `serviceId`.
      // Let's test the new unified import API that uses slug/code.
      // Wait, looking at AgencyController, it does not expose an endpoint to import purely by slug yet.
      // Ah, the controller doesn't have it, but the service `importCollection(agentId, code)` does.
      // So how does frontend import? Let's check AgencyController.
      // It looks like AgencyController.addToCollection takes `listingId` or `serviceId`.
      // Actually, wait, let's use the telegram endpoint or mock it?
      // I will just test the existing Web API for importing.

      const res = await api()
        .post(`/agency/import/${nodeASlug}`)
        .set('Authorization', `Bearer ${resellerToken}`)
        .send({
          markup_type: 'PERCENT',
          markup_value: 20,
          alias: 'Reseller Collection',
        })
        .expect(201);

      const body = res.body.node ? res.body.node : res.body;
      nodeBId = body.id;
      expect(nodeBId).toBeDefined();
      expect(body.parent_node_id).toBe(nodeAId);

      // Base for B is Total of A (110)
      // Markup for B is 20% of 110 = 22
      // Total for B is 110 + 22 = 132
      expect(Number(body.cache_cost_price)).toBe(110);
      expect(Number(body.markup_amount)).toBe(22);
      expect(Number(body.cache_total_price)).toBe(132);
    });
  });

  describe('3. Booking Flow', () => {
    it('should verify credit balance before booking (initially 0)', async () => {
      const res = await api()
        .get('/order/credit-summary')
        .set('Authorization', `Bearer ${resellerToken}`)
        .expect(200);

      const body = res.body as CreditSummaryBody;
      expect(Number(body.available_credit)).toBe(0);
    });

    // Note: Order creation might fail if user has no credit, depending on system rules.
    // The service has deposit_points: 10.
    // We might need to top up credit or mock it.
    // Since we don't have a top-up API exposed easily without payment provider,
    // let's see if we can "hack" it by updating the user directly via repository or if the system allows booking without credit (e.g. status PENDING_PAYMENT).
    // Looking at OrderService.create:
    // It usually checks credit.
    // Let's try to create order and expect 400 or 402 if no credit.
    // Or we can manually update the user in DB.

    it('should top up reseller credit (Repository Update)', async () => {
      const userRepo = dataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: resellerId });
      if (!user) throw new Error('Reseller not found in DB');

      user.credit_balance = 500;
      await userRepo.save(user);

      const res = await api()
        .get('/order/credit-summary')
        .set('Authorization', `Bearer ${resellerToken}`)
        .expect(200);

      const body = res.body as CreditSummaryBody;
      expect(Number(body.available_credit)).toBe(500);
    });

    it('should place an order via Node B', async () => {
      // Calculate a future date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const startTime = tomorrow.toISOString();

      const endTimeDate = new Date(tomorrow);
      endTimeDate.setHours(11, 0, 0, 0);
      const endTime = endTimeDate.toISOString();

      const res = await api()
        .post('/order')
        .set('Authorization', `Bearer ${resellerToken}`)
        .send({
          service_id: serviceId,
          agency_node_id: nodeBId,
          start_time: startTime,
          end_time: endTime,
        });

      expect(res.status).toBe(201);

      const order = res.body as OrderBody;
      expect(order.id).toBeDefined();
      expect(Number(order.display_price_snapshot)).toBe(132);
      expect(Number(order.service_snapshot.sale_price)).toBe(132);
    });
  });

  describe('4. Unavailable Semantics', () => {
    it('should return availability=off and slots 400 when service is deleted', async () => {
      const dateStr = '2030-01-02';

      const beforeRes = await api()
        .get(`/agency/collection/availability?date=${dateStr}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);
      const beforeBody = beforeRes.body as Record<string, string>;
      expect(beforeBody[nodeAId]).toBeDefined();
      expect(beforeBody[nodeAId]).not.toBe('off');

      const delRes = await api()
        .delete(`/services/${serviceId}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);
      const delBody = delRes.body as {
        is_active?: boolean;
        is_deleted?: boolean;
      };
      expect(delBody.is_deleted).toBe(true);
      expect(delBody.is_active).toBe(false);

      const afterRes = await api()
        .get(`/agency/collection/availability?date=${dateStr}`)
        .set('Authorization', `Bearer ${providerToken}`)
        .expect(200);
      const afterBody = afterRes.body as Record<string, string>;
      expect(afterBody[nodeAId]).toBe('off');

      const slotsRes = await api()
        .get(`/services/${serviceId}/slots?date=${dateStr}`)
        .expect(400);
      const slotsBody = slotsRes.body as {
        error_code?: string;
        message?: unknown;
      };
      expect(slotsBody.error_code).toBe('SERVICE_UNAVAILABLE');
      expect(slotsBody.message).toBeDefined();
    });
  });
});
