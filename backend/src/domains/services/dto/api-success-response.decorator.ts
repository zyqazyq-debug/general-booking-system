import type { Type } from '@nestjs/common';
import { ApiResponse, getSchemaPath } from '@nestjs/swagger';

type SuccessStatus = 200 | 201;

type SuccessResponseOptions = {
  isArray?: boolean;
  description?: string;
};

/** Documents the standard success envelope with a concrete payload schema. */
export function ApiSuccessResponse(
  status: SuccessStatus,
  dataModel: Type<unknown>,
  options: SuccessResponseOptions = {},
): MethodDecorator {
  const dataSchema = options.isArray
    ? { type: 'array', items: { $ref: getSchemaPath(dataModel) } }
    : { $ref: getSchemaPath(dataModel) };

  return ApiResponse({
    status,
    description: options.description ?? 'Successful response.',
    schema: {
      type: 'object',
      required: ['code', 'message', 'data'],
      properties: {
        code: { type: 'number', example: 0 },
        message: { type: 'string', example: 'OK' },
        data: dataSchema,
      },
    },
  });
}
