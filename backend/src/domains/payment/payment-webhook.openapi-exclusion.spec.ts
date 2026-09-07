import { MODULE_METADATA } from '@nestjs/common/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaymentController } from './payment.controller';
import { PaymentModule } from './payment.module';
import { PaymentService } from './payment.service';

type OpenApiExclusionManifest = {
  version: number;
  exclusions: Array<{
    method: string;
    public_path: string;
    openapi_path: string;
    owner: string;
    classification: string;
    reason: string;
    exposure: string;
    security_controls: string;
    review_date: string;
  }>;
};

const exclusionManifest =
  require('./payment-openapi-exclusions.json') as OpenApiExclusionManifest;

describe('Payment webhook OpenAPI exclusion', () => {
  it('keeps the provider webhook out of /api-json with a reviewable declaration', async () => {
    const paymentControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PaymentModule,
    ) as unknown[];
    const webhookExclusion = exclusionManifest.exclusions.find(
      (entry) => entry.openapi_path === '/payment/notify/{channel}',
    );

    expect(paymentControllers).toContain(PaymentController);
    expect(webhookExclusion).toMatchObject({
      method: 'POST',
      public_path: '/api/payment/notify/{channel}',
      owner: 'backend-payment-domain',
      classification: 'external-provider-webhook-adapter',
      review_date: '2026-12-07',
    });
    expect(webhookExclusion?.reason).toContain('provider-specific signed');
    expect(webhookExclusion?.security_controls).toContain(
      'PaymentProvider.verifyNotification',
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: {} }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Payment webhook harness').build(),
      );
      SwaggerModule.setup('api', app, document);
      const response = await request(app.getHttpServer()).get('/api-json');

      expect(response.status).toBe(200);
      expect(response.body.paths['/payment/notify/{channel}']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
