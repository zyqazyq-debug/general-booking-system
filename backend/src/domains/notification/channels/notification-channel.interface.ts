export interface NotificationChannel {
  send(recipient: string, content: string, title?: string): Promise<boolean>;
  get name(): string;
}
