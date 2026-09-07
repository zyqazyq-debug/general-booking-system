import {
  BadRequestException,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ZCreateOrderSchema } from './dto/create-order.schema';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

describe('OrderController command surface', () => {
  it('does not expose a generic PATCH endpoint for order mutation', () => {
    const routes = Object.getOwnPropertyNames(OrderController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(
          OrderController.prototype,
          name,
        )?.value;
        return {
          method: Reflect.getMetadata(METHOD_METADATA, handler),
          path: Reflect.getMetadata(PATH_METADATA, handler),
        };
      });

    expect(routes).not.toContainEqual({
      method: RequestMethod.PATCH,
      path: ':id',
    });
  });

  it('builds the internal create command from the authenticated consumer', () => {
    const orderService = {
      create: jest.fn(),
    } as unknown as OrderService;
    const controller = new OrderController(orderService);
    const request = {
      user: { id: 'authenticated-consumer' },
    } as AuthenticatedRequest;
    const body: CreateOrderDto = {
      service_id: 'service-1',
      agency_node_id: 'agency-1',
      start_time: '2026-03-27T10:00:00.000Z',
      end_time: '2026-03-27T11:00:00.000Z',
    };

    controller.create(request, body);

    expect(orderService.create).toHaveBeenCalledWith({
      consumer_id: 'authenticated-consumer',
      service_id: 'service-1',
      agency_node_id: 'agency-1',
      start_time: '2026-03-27T10:00:00.000Z',
      end_time: '2026-03-27T11:00:00.000Z',
    });
  });

  it('rejects client-owned consumer_id from the public create schema', () => {
    expect(
      ZCreateOrderSchema.safeParse({
        consumer_id: 'attacker-controlled-consumer',
        service_id: 'service-1',
        start_time: '2026-03-27T10:00:00.000Z',
        end_time: '2026-03-27T11:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects consumer_id through public DTO runtime validation', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        {
          consumer_id: 'attacker-controlled-consumer',
          service_id: 'service-1',
          start_time: '2026-03-27T10:00:00.000Z',
          end_time: '2026-03-27T11:00:00.000Z',
        },
        { metatype: CreateOrderDto, type: 'body', data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-string cancellation reason through runtime DTO validation', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform(
        { reason: { unexpected: 'object' } },
        { metatype: CancelOrderDto, type: 'body', data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
