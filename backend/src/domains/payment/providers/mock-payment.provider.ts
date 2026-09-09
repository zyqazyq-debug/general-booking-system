import {
  PaymentProvider,
  PrepayResponse,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.interface';
import { CreatePrepayDto } from '../dto/create-prepay.dto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentChannel } from '../payment.types';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  isAvailable(_channel: PaymentChannel): boolean {
    return this.isRuntimeEnabled();
  }

  private isRuntimeEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }

    return (
      process.env.NODE_ENV === 'test' ||
      process.env.PAYMENT_MOCK_ENABLED === 'true'
    );
  }

  private assertRuntimeEnabled(): void {
    if (!this.isRuntimeEnabled()) {
      throw new ServiceUnavailableException(
        'Mock payment provider is disabled in this environment',
      );
    }
  }

  async createPrepay(dto: CreatePrepayDto): Promise<PrepayResponse> {
    this.assertRuntimeEnabled();
    this.logger.log(`Creating mock prepay for channel ${dto.channel}`);
    return {
      success: true,
      prepay_id: `mock_prepay_${Date.now()}`,
      qr_code: `mock_qr_for_${dto.order_no}`,
      metadata: {
        mock: true,
        channel: dto.channel,
      },
    };
  }

  verifyNotification(
    channel: PaymentChannel,
    body: unknown,
    headers: Record<string, string | string[] | undefined> = {},
  ): Promise<VerifyNotifyResult> {
    this.logger.log('Verifying mock notification');
    const payload =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const rejected = (errorMessage: string): VerifyNotifyResult => ({
      success: false,
      order_no: '',
      trade_no: '',
      channel,
      amount_minor: 0,
      currency: 'CNY',
      raw_data: payload,
      error_message: errorMessage,
    });

    if (!this.isRuntimeEnabled()) {
      return Promise.resolve(rejected('Mock payment verification is disabled'));
    }

    const configuredSecret = process.env.PAYMENT_MOCK_CALLBACK_SECRET;
    const suppliedHeader = headers['x-mock-payment-signature'];
    const suppliedSecret = Array.isArray(suppliedHeader)
      ? suppliedHeader[0]
      : suppliedHeader;
    if (!configuredSecret || suppliedSecret !== configuredSecret) {
      return Promise.resolve(rejected('Invalid mock callback signature'));
    }

    const orderNo =
      typeof payload.order_no === 'string' ? payload.order_no.trim() : '';
    const tradeNo =
      typeof payload.trade_no === 'string' ? payload.trade_no.trim() : '';
    const amountMinor = Number(payload.amount_minor);
    const payloadChannel = payload.channel;
    if (
      !orderNo ||
      !tradeNo ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      payload.currency !== 'CNY' ||
      (payloadChannel !== undefined && payloadChannel !== channel)
    ) {
      return Promise.resolve(rejected('Invalid mock callback payload'));
    }

    return Promise.resolve({
      success: true,
      order_no: orderNo,
      trade_no: tradeNo,
      channel,
      amount_minor: amountMinor,
      currency: 'CNY',
      raw_data: payload,
    });
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    this.assertRuntimeEnabled();
    this.logger.log(`Querying mock status for ${orderNo}`);
    return {
      status: 'success',
      trade_no: `mock_trade_${Date.now()}`,
    };
  }
}
