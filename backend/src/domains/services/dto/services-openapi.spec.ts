import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ServiceAvailabilityService } from '../service-availability.service';
import { ServicesController } from '../services.controller';
import { ServicesService } from '../services.service';
import { SERVICES_AGENCY_PORT } from '../ports/tokens';

describe('Services request OpenAPI contract', () => {
  it('documents concrete service and block request bodies without server-owned fields', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [
        { provide: ServicesService, useValue: {} },
        { provide: SERVICES_AGENCY_PORT, useValue: {} },
        { provide: ServiceAvailabilityService, useValue: {} },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Services request contract').build(),
      );
      const schemas = document.components?.schemas ?? {};
      const createService = schemas.CreateServiceDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, unknown>;
      };
      const updateService = schemas.UpdateServiceDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, unknown>;
      };
      const createBlock = schemas.CreateServiceBlockDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, unknown>;
      };
      const updateBlock = schemas.UpdateServiceBlockDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, unknown>;
      };

      expect(createService).toMatchObject({
        type: 'object',
        required: ['title', 'base_price', 'deposit_points'],
        properties: {
          title: { type: 'string' },
          base_price: { type: 'number' },
          deposit_points: { type: 'number' },
          duration_minutes: { type: 'number' },
          is_active: { type: 'boolean' },
          rules: { $ref: '#/components/schemas/ServiceRulesDto' },
          cancellation_policy: {
            $ref: '#/components/schemas/CancellationPolicyDto',
          },
          location: { type: 'object', additionalProperties: true },
        },
      });
      expect(createService.properties).not.toHaveProperty('owner_id');
      expect(createService.properties).toMatchObject({
        metadata: { type: 'object', additionalProperties: true },
      });
      const metadata = createService.properties?.metadata as {
        oneOf?: unknown;
        items?: unknown;
        nullable?: boolean;
      };
      expect(metadata.oneOf).toBeUndefined();
      expect(metadata.items).toBeUndefined();
      expect(metadata.nullable).toBeUndefined();

      expect(updateService).toMatchObject({
        type: 'object',
        properties: expect.objectContaining({ title: { type: 'string' } }),
      });
      expect(updateService.required ?? []).toHaveLength(0);
      expect(updateService.properties).not.toHaveProperty('owner_id');

      expect(createBlock).toMatchObject({
        type: 'object',
        required: ['type', 'start_time', 'end_time'],
        properties: {
          type: {
            type: 'string',
            enum: ['TIME_OFF', 'HOLIDAY', 'MAINTENANCE'],
          },
          start_time: { type: 'string', format: 'date-time' },
          end_time: { type: 'string', format: 'date-time' },
          reason: { type: 'string' },
        },
      });
      expect(updateBlock).toMatchObject({
        type: 'object',
        properties: expect.objectContaining({
          start_time: { type: 'string', format: 'date-time' },
        }),
      });
      expect(updateBlock.required ?? []).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
