import { CreatePrepayDto } from '../dto/create-prepay.dto';
import { PaymentChannel } from '../payment.types';

export interface PrepayResponse {
  success: boolean;
  prepay_id?: string;
  payment_url?: string;
  qr_code?: string;
  metadata?: Record<string, unknown>;
  error_message?: string;
}

export interface VerifyNotifyResult {
  success: boolean;
  order_no: string;
  trade_no: string;
  channel: PaymentChannel;
  amount_minor: number;
  currency: 'CNY';
  raw_data: Record<string, unknown>;
  error_message?: string;
}

export interface QueryStatusResult {
  status: string;
  trade_no: string;
}

export interface PaymentProvider {
  isAvailable(channel: PaymentChannel): boolean;
  createPrepay(dto: CreatePrepayDto): Promise<PrepayResponse>;
  verifyNotification(
    channel: PaymentChannel,
    body: unknown,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<VerifyNotifyResult>;
  queryStatus(orderNo: string): Promise<QueryStatusResult>;
}
