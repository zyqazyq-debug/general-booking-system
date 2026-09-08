import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodSchema) {}

  transform(value: any, metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        validation: issue.code,
      }));
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: errors.map((e) => `${e.field}: ${e.message}`),
        errors,
      });
    }
    return result.data;
  }
}
