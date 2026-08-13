export type NotificationUserContactDto = {
  id: string;
  telegram_chat_id?: string;
};

export interface NotificationUsersPort {
  findContactById(userId: string): Promise<NotificationUserContactDto | null>;
}
