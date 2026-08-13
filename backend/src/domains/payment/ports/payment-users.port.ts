export interface PaymentUsersPort {
  addCredit(userId: string, amount: number): Promise<void>;
}
