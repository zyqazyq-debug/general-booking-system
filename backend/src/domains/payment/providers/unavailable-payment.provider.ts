import { Injectable } from '@nestjs/common';
import type { CreatePrepayDto } from '../dto/create-prepay.dto';
import type { PaymentChannel } from '../payment.types';
import type {
  PaymentProvider,
  PrepayResponse,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.interface';

@Injectable()
export class UnavailablePaymentProvider implements PaymentProvider {
  isAvailable(_channel: PaymentChannel): boolean {
    return false;
  }

  createPrepay(_dto: CreatePrepayDto): Promise<PrepayResponse> {
    return Promise.resolve({
      success: false,
      error_message: 'No production payment provider is configured',
    });
  }

  verifyNotification(
    channel: PaymentChannel,
    body: unknown,
  ): Promise<VerifyNotifyResult> {
    return Promise.resolve({
      success: false,
      order_no: '',
      trade_no: '',
      channel,
      amount_minor: 0,
      currency: 'CNY',
      raw_data:
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {},
      error_message: 'No production payment verifier is configured',
    });
  }

  queryStatus(_orderNo: string): Promise<QueryStatusResult> {
    return Promise.resolve({ status: 'unavailable', trade_no: '' });
  }
}
