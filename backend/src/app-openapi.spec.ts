import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Client debug log OpenAPI boundary', () => {
  it('publishes a concrete, non-empty request schema', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('App request contract').build(),
      );
      SwaggerModule.setup('api', app, document);
      await app.init();
      const response = await request(app.getHttpServer()).get('/api-json');
      const schema = response.body.components?.schemas?.ClientDebugLogDto;
      const responseSchema =
        response.body.components?.schemas?.ClientDebugLogResponseDto;
      const createdResponse = response.body.paths['/debug/log']?.post?.responses?.[
        '201'
      ];
      const referralResponses = response.body.paths['/r/{code}']?.get?.responses;
      const shareResponses = response.body.paths['/s/{slug}']?.get?.responses;

      expect(response.status).toBe(200);
      expect(
        response.body.paths['/debug/log']?.post?.requestBody,
      ).toBeDefined();
      expect(schema).toMatchObject({
        type: 'object',
        required: ['event'],
        properties: {
          event: { type: 'string', minLength: 1 },
          url: { type: 'string' },
          hasToken: { type: 'boolean' },
          by_scene: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['newFieldRead', 'legacyFieldRead'],
            },
          },
        },
      });
      expect(createdResponse).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ClientDebugLogResponseDto',
            },
          },
        },
      });
      expect(responseSchema).toMatchObject({
        type: 'object',
        required: ['success'],
        properties: {
          success: { type: 'boolean', example: true },
        },
      });
      expect(referralResponses).toEqual({
        '302': {
          description: 'Redirects to registration with the referral code.',
          headers: {
            Location: {
              description:
                'Registration route containing the encoded referral code.',
              schema: { type: 'string' },
            },
          },
        },
      });
      expect(shareResponses).toEqual({
        '302': {
          description: 'Redirects to booking detail for the shared slug.',
          headers: {
            Location: {
              description:
                'Booking detail route containing the encoded shared slug.',
              schema: { type: 'string' },
            },
          },
        },
      });

      await request(app.getHttpServer())
        .post('/debug/log')
        .send({
          event: 'REQUEST_START',
          url: '/api/services',
          hasToken: true,
          total_reads: 2,
        })
        .expect(201)
        .expect({ success: true });

      await request(app.getHttpServer())
        .post('/debug/log')
        .send({ url: '/api/services' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/debug/log')
        .send({ event: 'REQUEST_START', undeclared: true })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
