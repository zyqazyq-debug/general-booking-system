import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_METADATA } from '../decorators/raw-response.decorator';

interface Wrapped<T = unknown> {
  code: number;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType();

    // Skip transformation for Telegraf/RPC contexts to avoid side effects
    // Telegraf handlers usually return void or specific message objects, not standard API responses
    if (type !== 'http') {
      return next.handle();
    }

    // Health and release-identity endpoints are consumed by deployment gates.
    // Their payloads are versioned external contracts, not normal API DTOs.
    if (Reflect.getMetadata(RAW_RESPONSE_METADATA, context.getHandler())) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        // If already wrapped, pass through
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          'data' in data
        ) {
          return data;
        }
        const res: Wrapped = {
          code: 0,
          message: 'OK',
          data,
        };
        return res;
      }),
    );
  }
}
