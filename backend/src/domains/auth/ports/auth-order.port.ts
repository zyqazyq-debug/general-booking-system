import { EntityManager } from 'typeorm';

export interface AuthOrderPort {
  transferOrders(
    sourceUserId: string,
    targetUserId: string,
    manager?: EntityManager,
  ): Promise<void>;
}
