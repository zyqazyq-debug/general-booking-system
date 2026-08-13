import {
  PaymentProvider,
  PrepayResponse,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.interface';
import { CreatePrepayDto } from '../dto/create-prepay.dto';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  createPrepay(dto: CreatePrepayDto): Promise<PrepayResponse> {
    this.logger.log(`Creating mock prepay for channel ${dto.channel}`);
    return Promise.resolve({
      success: true,
      prepay_id: `mock_prepay_${Date.now()}`,
      qr_code: `mock_qr_for_${dto.order_no}`,
      metadata: {
        mock: true,
        channel: dto.channel,
      },
    });
  }

  verifyNotification(body: unknown): Promise<VerifyNotifyResult> {
    this.logger.log('Verifying mock notification');
    const payload =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const orderNoValue = payload.order_no;
    const orderNo =
      typeof orderNoValue === 'string' || typeof orderNoValue === 'number'
        ? String(orderNoValue)
        : '';
    const amount = Number(payload.amount ?? 0);
    return Promise.resolve({
      success: true,
      order_no: orderNo,
      trade_no: `mock_trade_${Date.now()}`,
      amount,
      raw_data: payload,
    });
  }

  queryStatus(orderNo: string): Promise<QueryStatusResult> {
    this.logger.log(`Querying mock status for ${orderNo}`);
    return Promise.resolve({
      status: 'success',
      trade_no: `mock_trade_${Date.now()}`,
    });
  }
}
