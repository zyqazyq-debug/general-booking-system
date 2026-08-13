import type { EntityManager } from 'typeorm';

export interface OrderUserSnapshot {
  id: string;
  username?: string | null;
  nickname?: string | null;
  telegram_chat_id?: string | null;
  credit_balance?: number | string | null;
}

export interface OrderUserContactDto {
  id: string;
  username: string;
  nickname: string;
  telegram_chat_id: string;
  credit_balance: number;
}

export interface OrderUsersPort {
  findUserById(userId: string): Promise<OrderUserSnapshot | null>;
  findContactById(userId: string): Promise<OrderUserContactDto | null>;

  freezeCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void>;
  unfreezeCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void>;
  burnCredit(
    userId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void>;
  transferFrozenCredit(
    fromUserId: string,
    toUserId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void>;
}
