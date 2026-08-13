import { HttpException, HttpStatus } from '@nestjs/common';
import { BusinessErrorCode } from './business-error-code';

type BusinessExceptionPayload = {
  message: string;
  error_code: BusinessErrorCode | string;
  details?: Record<string, unknown>;
};

export class BusinessException extends HttpException {
  constructor(status: HttpStatus, payload: BusinessExceptionPayload) {
    super(
      {
        message: payload.message,
        error_code: payload.error_code,
        ...(payload.details ? payload.details : {}),
      },
      status,
    );
  }

  static badRequest(payload: BusinessExceptionPayload) {
    return new BusinessException(HttpStatus.BAD_REQUEST, payload);
  }

  static notFound(payload: BusinessExceptionPayload) {
    return new BusinessException(HttpStatus.NOT_FOUND, payload);
  }
}
