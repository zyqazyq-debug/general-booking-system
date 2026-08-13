import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { config as loadDotenv } from 'dotenv';
loadDotenv();
process.env.JWT_SECRET = 'test_secret_for_e2e_testing_only';
process.env.JWT_SECRET1 = 'test_secret_for_e2e_testing_only';
process.env.JWT_SECRET_ACTIVE_INDEX = '1';
process.env.USE_POSTGRES = 'false';
process.env.TYPEORM_SYNCHRONIZE = 'true';
process.env.NODE_ENV = 'test';
process.env.H5_URL = 'http://localhost:8080';
process.env.TELEGRAM_BOT_TOKEN = 'DUMMY';
process.env.TELEGRAM_WEBAPP_URL = 'http://localhost:3000';

import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

type LoginBody = { access_token: string };
type ServiceBody = { id: string; base_price: number | string };
type CollectionBody = {
  id: string;
  parent_node_id?: string | null;
  service_id?: string;
  share_slug?: string;
};
type ResolveSlugBody = {
  importInfo: {
    parentNodeId: string;
  };
};
type ImportCheckBody = {
  action_type: string;
  parent_id?: string;
};

describe('Agency Import Confirm (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let providerToken: string;
  let resellerToken: string;
  let serviceId: string;
  let providerNodeId: string;
  let providerSlug: string;

  const api = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get<DataSource>(DataSource);
    const entities = dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = dataSource.getRepository(entity.name);
      await repository.query('PRAGMA foreign_keys = OFF');
      await repository.query(`DELETE FROM "${entity.tableName}"`);
      await repository.query('PRAGMA foreign_keys = ON');
    }
  }, 30000);

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
  }, 30000);

  it('should setup users and service', async () => {
    await api()
      .post('/auth/register')
      .send({ username: 'provider_import_confirm', password: 'password123' })
      .expect(201);
    await api()
      .post('/auth/register')
      .send({ username: 'reseller_import_confirm', password: 'password123' })
      .expect(201);

    const providerLogin = await api()
      .post('/auth/login')
      .send({ username: 'provider_import_confirm', password: 'password123' })
      .expect(201);
    providerToken = (providerLogin.body as LoginBody).access_token;
    expect(providerToken).toBeDefined();

    const resellerLogin = await api()
      .post('/auth/login')
      .send({ username: 'reseller_import_confirm', password: 'password123' })
      .expect(201);
    resellerToken = (resellerLogin.body as LoginBody).access_token;
    expect(resellerToken).toBeDefined();

    const serviceRes = await api()
      .post('/services')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        title: 'Import Confirm E2E Service',
        description: 'Import confirm E2E',
        base_price: 100,
        duration_minutes: 60,
        deposit_points: 0,
        is_active: true,
        rules: { start_hour: 0, end_hour: 24, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      })
      .expect(201);

    const service = serviceRes.body as ServiceBody;
    serviceId = service.id;
    expect(serviceId).toBeDefined();

    const rootNodeRes = await api()
      .post('/agency/collection')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        serviceId,
        markup_type: 'PERCENT',
        markup_value: 0,
        alias: 'Provider Root Node',
      })
      .expect(201);

    const rootNode = rootNodeRes.body as CollectionBody;
    providerNodeId = rootNode.id;
    providerSlug = String(rootNode.share_slug || '');
    expect(providerNodeId).toBeDefined();
    expect(providerSlug).toMatch(/^s[a-z0-9]{8}$/i);
  });

  it('should return SAME_PARENT on import check, and still allow creating a new child after confirm', async () => {
    const resolved = await api()
      .get(`/agency/s/${providerSlug}`)
      .set('Authorization', `Bearer ${resellerToken}`)
      .expect(200);
    const resolvedBody = resolved.body as ResolveSlugBody;
    const parentNodeId = resolvedBody.importInfo.parentNodeId;
    expect(parentNodeId).toBe(providerNodeId);

    const firstImport = await api()
      .post('/agency/collection')
      .set('Authorization', `Bearer ${resellerToken}`)
      .send({
        serviceId,
        parentNodeId,
        markup_type: 'FIXED',
        markup_value: 10,
        alias: 'Reseller Node #1',
      })
      .expect(201);
    const firstNodeId = (firstImport.body as CollectionBody).id;
    expect(firstNodeId).toBeDefined();

    const checkRes = await api()
      .get(`/agency/import/check/${providerSlug}`)
      .set('Authorization', `Bearer ${resellerToken}`)
      .expect(200);
    const checkBody = checkRes.body as ImportCheckBody;
    expect(checkBody.action_type).toBe('SAME_PARENT');
    expect(checkBody.parent_id).toBe(providerNodeId);
    if (!checkBody.parent_id) {
      throw new Error('Expected parent_id');
    }

    const secondImport = await api()
      .post('/agency/collection')
      .set('Authorization', `Bearer ${resellerToken}`)
      .send({
        serviceId,
        parentNodeId: checkBody.parent_id,
        markup_type: 'FIXED',
        markup_value: 10,
        alias: 'Reseller Node #2',
      })
      .expect(201);
    const secondNodeId = (secondImport.body as CollectionBody).id;
    expect(secondNodeId).toBeDefined();
    expect(secondNodeId).not.toBe(firstNodeId);
  });

  it('should reject negative markup_value with 400 instead of DB exception', async () => {
    await api()
      .post('/agency/collection')
      .set('Authorization', `Bearer ${resellerToken}`)
      .send({
        serviceId,
        parentNodeId: providerNodeId,
        markup_type: 'FIXED',
        markup_value: -0.01,
        alias: 'Negative Markup Should Fail',
      })
      .expect(400);
  });
});
