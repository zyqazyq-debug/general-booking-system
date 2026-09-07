import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OrderController } from './order.controller';

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
});
