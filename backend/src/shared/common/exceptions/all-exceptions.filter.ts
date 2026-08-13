import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { captureBackendException } from '../observability/sentry';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const isProd = process.env.NODE_ENV === 'production';
    const type = host.getType();

    if (type === 'http') {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
      captureBackendException(exception, request);

      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

      let message = 'Internal server error';
      const code = status;
      let data: unknown = null;
      let errorCode: string | null = null;

      if (exception instanceof HttpException) {
        const res = exception.getResponse();
        if (typeof res === 'object' && res !== null) {
          const record = res as Record<string, unknown>;
          if ('message' in record) {
            const msg = record.message;
            message = Array.isArray(msg) ? String(msg[0]) : String(msg);
          }
          if (
            'error_code' in record &&
            (typeof record.error_code === 'string' ||
              typeof record.error_code === 'number')
          ) {
            errorCode = String(record.error_code);
          }
          const dataRecord = Object.fromEntries(
            Object.entries(record).filter(
              ([key]) =>
                !['message', 'statusCode', 'error', 'error_code'].includes(key),
            ),
          );
          if (Object.keys(dataRecord).length > 0) {
            data = dataRecord;
          }
          if (status === (HttpStatus.SERVICE_UNAVAILABLE as number)) {
            data = res;
          }
        } else if (typeof res === 'string') {
          message = res;
        }
      } else if (exception instanceof Error) {
        this.logger.error(`Error: ${exception.message}`, exception.stack);
        if (!isProd) {
          message = exception.message;
          data = { stack: exception.stack };
        }
      }

      if (isProd && status >= 500) {
        message = 'Internal server error';
        data = null;
      }

      const responseBody = {
        code: code === 0 || code === 200 ? -1 : code,
        message: message,
        error_code: errorCode,
        data: data,
        timestamp: new Date().toISOString(),
        path: request.url,
      };

      response.status(status).json(responseBody);
    } else {
      captureBackendException(exception);
      // Handle non-HTTP contexts (e.g., Telegraf, RPC, Microservices)
      // Just log the error to avoid crashing the application with "response.status is not a function"
      this.logger.error(
        `[${type}] Unhandled Exception: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : '',
      );
    }
  }
}
