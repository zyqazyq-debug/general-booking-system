import { MODULE_METADATA } from '@nestjs/common/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReferralController } from './referral.controller';
import {
  ReferralModule,
  REFERRAL_PRODUCTION_CONTROLLERS,
} from './referral.module';
import { ReferralService } from './referral.service';
import { ReferralTestController } from './referral-test.controller';
import { ReferralTestModule } from './referral-test.module';

describe('Referral production OpenAPI boundary', () => {
  it('keeps simulation out of the production module and generated document', async () => {
    const productionControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ReferralModule,
    ) as unknown[];
    const testControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ReferralTestModule,
    ) as unknown[];

    expect(productionControllers).toEqual(REFERRAL_PRODUCTION_CONTROLLERS);
    expect(productionControllers).toContain(ReferralController);
    expect(productionControllers).not.toContain(ReferralTestController);
    expect(testControllers).toContain(ReferralTestController);

    const testingModule = await Test.createTestingModule({
      controllers: REFERRAL_PRODUCTION_CONTROLLERS,
      providers: [
        {
          provide: ReferralService,
          useValue: { getReferralLogs: jest.fn() },
        },
      ],
    }).compile();
    const app = testingModule.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Production referral harness').build(),
      );
      SwaggerModule.setup('api', app, document);
      const response = await request(app.getHttpServer()).get('/api-json');

      expect(response.status).toBe(200);
      expect(response.body.paths['/referral/simulate-payment']).toBeUndefined();
      expect(
        response.body.components?.schemas?.SimulatePaymentDto,
      ).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
