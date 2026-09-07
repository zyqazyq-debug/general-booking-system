import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PaymentChannel } from '../../../payment/payment.types';
import { CollectionQuotaController } from '../collection-quota.controller';
import { CollectionQuotaService } from '../collection-quota.service';

describe('CreateCollectionQuotaPurchaseIntentDto OpenAPI contract', () => {
  it('documents constrained quota purchase properties on the real endpoint', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CollectionQuotaController],
      providers: [{ provide: CollectionQuotaService, useValue: {} }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Quota DTO harness').build(),
      );
      const schema =
        document.components?.schemas?.CreateCollectionQuotaPurchaseIntentDto;

      expect(schema).toMatchObject({
        type: 'object',
        required: ['extra_slots'],
        properties: {
          extra_slots: { type: 'integer', minimum: 1 },
          months: { type: 'integer', minimum: 1, default: 1 },
          channel: {
            type: 'string',
            enum: [PaymentChannel.WECHAT, PaymentChannel.ALIPAY],
            default: PaymentChannel.WECHAT,
          },
        },
      });
    } finally {
      await app.close();
    }
  });
});
