export const REFERRAL_REWARD_POSTING_PORT = Symbol(
  'REFERRAL_REWARD_POSTING_PORT',
);

export interface ReferralRewardPostingCommand {
  paymentEventId: string;
  payerUserId: string;
  amountMinor: number;
  currency: 'CNY';
  orderNo: string;
  tradeNo: string;
}

export interface ReferralRewardPosting {
  beneficiaryUserId: string;
  level: number;
  rewardAmountMinor: number;
  ledgerEntryId: string;
}

export interface ReferralRewardPostingResult {
  duplicate: boolean;
  postings: ReferralRewardPosting[];
}

/**
 * Implemented by the owner of users/financial ledgers.
 * The implementation must resolve the referral chain server-side and atomically
 * deduplicate every posting on paymentEventId. Callers may safely retry.
 */
export interface ReferralRewardPostingPort {
  postRewards(
    command: ReferralRewardPostingCommand,
  ): Promise<ReferralRewardPostingResult>;
}
