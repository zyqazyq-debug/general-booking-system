export interface PaymentCreditPostingCommand {
  paymentEventId: string;
  userId: string;
  amountMinor: number;
  currency: 'CNY';
  orderNo: string;
  tradeNo: string;
}

export interface PaymentCreditPostingResult {
  duplicate: boolean;
  ledgerEntryId: string;
}

export interface PaymentUsersPort {
  /**
   * Financial posting must be atomic and idempotent on paymentEventId.
   * Optional only while the users domain migrates from the unsafe legacy API;
   * payment handling fails closed when this operation is unavailable.
   */
  postPaymentCredit?(
    command: PaymentCreditPostingCommand,
  ): Promise<PaymentCreditPostingResult>;

  /** @deprecated Non-idempotent legacy API. Payment listeners must not call it. */
  addCredit(userId: string, amount: number): Promise<void>;
}
