export type NotificationDeliveryResult =
  | {
      outcome: 'sent';
      providerMessageId: string;
    }
  | {
      outcome: 'failed' | 'uncertain';
      errorType: string;
    };
