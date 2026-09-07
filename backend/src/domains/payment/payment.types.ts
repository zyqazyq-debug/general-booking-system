export enum PaymentTransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum PaymentChannel {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
}

export enum PaymentPurpose {
  CREDIT_PURCHASE = 'CREDIT_PURCHASE',
  SOFTWARE_FEE = 'SOFTWARE_FEE',
  UNKNOWN = 'UNKNOWN',
}
