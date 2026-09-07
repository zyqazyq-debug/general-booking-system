export type VerifiedIdentityProof = {
  proofId: string;
  provider: 'wechat' | 'qq' | 'telegram';
  subject: string;
};

export interface AuthIdentityProofPort {
  consume(
    proof: string,
    expectedProvider: VerifiedIdentityProof['provider'],
    expectedActorId?: string,
  ): Promise<VerifiedIdentityProof>;
}
