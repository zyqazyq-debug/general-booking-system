import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

type OpenApiSchema = {
  type?: string;
  format?: string;
  default?: number;
  minimum?: number;
};

describe('Order OpenAPI request boundary', () => {
  it('documents the public create payload without the server-derived consumer', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        {
          provide: OrderService,
          useValue: {},
        },
      ],
    }).compile();
    const app = testingModule.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Order request contract').build(),
      );
      const schemas = document.components?.schemas ?? {};
      const createOrder = schemas.CreateOrderDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, OpenApiSchema>;
      };
      const manageParameters = document.paths['/order/manage']?.get
        ?.parameters as Array<{
        name?: string;
        required?: boolean;
        schema?: OpenApiSchema;
      }>;
      const cancelRequest = document.paths['/order/{id}/cancel']?.post
        ?.requestBody as { content?: Record<string, { schema?: unknown }> };
      const cancelOrder = schemas.CancelOrderDto as {
        type?: string;
        required?: string[];
        properties?: Record<string, OpenApiSchema>;
      };
      const parameter = (name: string) =>
        manageParameters.find((item) => item.name === name);

      expect(createOrder).toEqual(
        expect.objectContaining({
          type: 'object',
          required: expect.arrayContaining([
            'service_id',
            'start_time',
            'end_time',
          ]),
          properties: expect.objectContaining({
            service_id: expect.objectContaining({ type: 'string' }),
            agency_node_id: expect.objectContaining({ type: 'string' }),
            start_time: expect.objectContaining({
              type: 'string',
              format: 'date-time',
            }),
            end_time: expect.objectContaining({
              type: 'string',
              format: 'date-time',
            }),
          }),
        }),
      );
      expect(createOrder.properties).not.toHaveProperty('consumer_id');
      expect(createOrder.required).not.toContain('agency_node_id');

      expect(cancelRequest?.content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/CancelOrderDto',
      });
      expect(cancelOrder).toMatchObject({
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      });
      expect(cancelOrder.required ?? []).toHaveLength(0);

      expect(parameter('page')).toEqual(
        expect.objectContaining({
          required: false,
          schema: expect.objectContaining({
            type: 'number',
            minimum: 1,
            default: 1,
          }),
        }),
      );
      expect(parameter('limit')).toEqual(
        expect.objectContaining({
          required: false,
          schema: expect.objectContaining({
            type: 'number',
            minimum: 1,
            default: 10,
          }),
        }),
      );
      expect(parameter('start_time')).toEqual(
        expect.objectContaining({
          required: false,
          schema: expect.objectContaining({
            type: 'string',
            format: 'date-time',
          }),
        }),
      );
      expect(parameter('end_time')).toEqual(
        expect.objectContaining({
          required: false,
          schema: expect.objectContaining({
            type: 'string',
            format: 'date-time',
          }),
        }),
      );
      expect(schemas.UpdateOrderDto).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
