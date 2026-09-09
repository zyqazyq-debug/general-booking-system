export const TELEGRAM_VALIDATOR = 'ITelegramValidator';

export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramBotProfile {
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface ITelegramValidator {
  validateWebAppData(initData: string): {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    photoUrl?: string;
  };
  validateBotData(authData: TelegramAuthData): void; // Throws if invalid
  generateLoginToken(userId?: string): Promise<string>;
  getBotDeepLink(token: string): Promise<string>;
  getBotInfo(): Promise<{ username: string; first_name: string }>;
  getTokenStatus(token: string): Promise<{
    status: 'pending' | 'success' | 'expired' | 'not_found';
    result?: unknown;
  }>;
}
