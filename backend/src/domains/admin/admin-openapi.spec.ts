import { CanActivate, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard, RolesGuard } from '../auth';

describe('Admin credit adjustment OpenAPI boundary', () => {
  it('publishes a concrete amount request body', async () => {
    const adjustCredit = jest.fn().mockResolvedValue({ amount: 12.5 });
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: { adjustCredit } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true } satisfies CanActivate)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true } satisfies CanActivate)
      .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Admin request contract').build(),
      );
      SwaggerModule.setup('api', app, document);
      const response = await request(app.getHttpServer()).get('/api-json');
      const schema = response.body.components?.schemas?.AdjustUserCreditDto;

      expect(response.status).toBe(200);
      expect(
        response.body.paths['/admin/users/{id}/credit']?.post?.requestBody,
      ).toBeDefined();
      expect(schema).toEqual({
        type: 'object',
        properties: {
          amount: { type: 'number', format: 'double' },
        },
        required: ['amount'],
      });

      await request(app.getHttpServer())
        .post('/admin/users/user-1/credit')
        .send({ amount: '12.5' })
        .expect(201)
        .expect({ amount: 12.5 });
      expect(adjustCredit).toHaveBeenCalledWith('user-1', 12.5);

      await request(app.getHttpServer())
        .post('/admin/users/user-1/credit')
        .send({ amount: 'not-a-number' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/admin/users/user-1/credit')
        .send({ amount: 10, undeclared: true })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
