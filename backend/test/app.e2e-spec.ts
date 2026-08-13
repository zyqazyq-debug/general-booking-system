import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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

import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'DUMMY';
    process.env.JWT_SECRET = 'test_secret_for_e2e_testing_only';
    process.env.JWT_SECRET1 = 'test_secret_for_e2e_testing_only';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      try {
        await app.close();
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!error.includes('Bot is not running')) {
          throw e;
        }
      }
    }
  }, 30000);

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect((res) => {
        // Since Telegram is DUMMY in e2e tests, the health check will return 503 Service Unavailable
        // We just want to make sure the endpoint is reachable and returns the expected structure
        if (res.status !== 200 && res.status !== 503) {
          throw new Error(`Expected 200 or 503, got ${res.status}`);
        }
      });
  }, 15000);
});
