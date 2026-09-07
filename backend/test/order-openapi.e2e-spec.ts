import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

process.env.JWT_SECRET = 'order_openapi_e2e_secret';
process.env.JWT_SECRET1 = 'order_openapi_e2e_secret';
process.env.JWT_SECRET_ACTIVE_INDEX = '1';
process.env.USE_POSTGRES = 'false';
process.env.TYPEORM_SYNCHRONIZE = 'true';
process.env.NODE_ENV = 'test';
process.env.H5_URL = 'http://localhost:8080';
process.env.TELEGRAM_BOT_TOKEN = 'DUMMY';
process.env.TELEGRAM_WEBAPP_URL = 'http://localhost:3000';

import { AppModule } from '../src/app.module';
import { setupSwagger } from '../src/shared/common/setup-swagger';

describe('Order public request contract (AppModule)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    setupSwagger(app);
    await app.init();

    const username = `order_openapi_${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username,
        password: 'password123',
        email: `${username}@example.test`,
      })
      .expect(201);
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'password123' })
      .expect(201);
    accessToken = loginResponse.body.access_token as string;
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

  it('serves concrete create and cancel request bodies from /api-json', async () => {
    const response = await request(app.getHttpServer())
      .get('/api-json')
      .expect(200);
    const schemas = response.body.components?.schemas ?? {};
    const createRequest = response.body.paths['/api/order']?.post?.requestBody;
    const cancelRequest =
      response.body.paths['/api/order/{id}/cancel']?.post?.requestBody;

    expect(createRequest).toBeDefined();
    expect(cancelRequest).toBeDefined();
    expect(schemas.CreateOrderDto).toMatchObject({
      type: 'object',
      required: ['service_id', 'start_time', 'end_time'],
      properties: {
        service_id: { type: 'string' },
        agency_node_id: { type: 'string' },
        start_time: { type: 'string', format: 'date-time' },
        end_time: { type: 'string', format: 'date-time' },
      },
    });
    expect(schemas.CreateOrderDto.properties).not.toHaveProperty('consumer_id');
    expect(schemas.CancelOrderDto).toMatchObject({
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
    });
  });

  it('rejects a client-supplied consumer_id before order creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/order')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        consumer_id: 'attacker-controlled-consumer',
        service_id: 'service-1',
        start_time: '2026-03-27T10:00:00.000Z',
        end_time: '2026-03-27T11:00:00.000Z',
      })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('consumer_id');
  });
});
