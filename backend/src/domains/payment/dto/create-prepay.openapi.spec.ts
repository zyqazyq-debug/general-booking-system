import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PaymentController } from '../payment.controller';
import { PaymentService } from '../payment.service';
import { PaymentChannel } from '../payment.types';

describe('CreatePrepayDto OpenAPI contract', () => {
  it('documents constrained payment request properties on the real endpoint', async () => {
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
      const schema = document.components?.schemas?.CreatePrepayDto;

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
