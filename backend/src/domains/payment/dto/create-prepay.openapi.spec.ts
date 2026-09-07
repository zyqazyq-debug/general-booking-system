import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaymentController } from '../payment.controller';
import { PaymentService } from '../payment.service';
import { PaymentChannel } from '../payment.types';

describe('CreatePrepayDto OpenAPI contract', () => {
  it('serves constrained payment request properties from /api-json', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: {} }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Payment DTO harness').build(),
      );
      SwaggerModule.setup('api', app, document);
      const response = await request(app.getHttpServer()).get('/api-json');
      const schema = response.body.components?.schemas?.CreatePrepayDto;

      expect(response.status).toBe(200);
      expect(
        response.body.paths['/payment/prepay']?.post?.requestBody,
      ).toBeDefined();
      expect(schema).toMatchObject({
        type: 'object',
        required: ['channel', 'order_no', 'amount', 'subject'],
        properties: {
          channel: {
            type: 'string',
            enum: [PaymentChannel.WECHAT, PaymentChannel.ALIPAY],
          },
          order_no: { type: 'string', maxLength: 64 },
          amount: { type: 'number', format: 'double', minimum: 0.01 },
          subject: { type: 'string', maxLength: 128 },
          return_url: { type: 'string', format: 'uri', maxLength: 255 },
          notify_url: { type: 'string', format: 'uri', maxLength: 255 },
          metadata: { type: 'object', additionalProperties: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});
