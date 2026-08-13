export interface TelegramBotInfo {
  username?: string;
  id?: number;
}

export interface HealthTelegramPort {
  getBotInfo(): Promise<TelegramBotInfo>;
}
