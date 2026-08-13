export interface OrderNotificationPort {
  sendDirectMessage(userId: string, message: string): Promise<void>;
}
