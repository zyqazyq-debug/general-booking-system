import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { ConsumedIdentityProof } from '../entities/consumed-identity-proof.entity';
import type {
  AuthIdentityProofPort,
  VerifiedIdentityProof,
} from '../ports/auth-identity-proof.port';

type IdentityProofPayload = {
  token_use: 'identity_proof';
  provider: VerifiedIdentityProof['provider'];
  sub: string;
  jti: string;
  actor_id?: string;
  exp: number;
};

@Injectable()
export class SignedIdentityProofAdapter implements AuthIdentityProofPort {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(ConsumedIdentityProof)
    private readonly consumedProofs: Repository<ConsumedIdentityProof>,
  ) {}

  async consume(
    proof: string,
    expectedProvider: VerifiedIdentityProof['provider'],
    expectedActorId?: string,
  ): Promise<VerifiedIdentityProof> {
    const secret = this.configService.get<string>('IDENTITY_PROOF_SECRET');
    if (!secret) {
      throw new UnauthorizedException(
        'Verified identity proof adapter is not configured',
      );
    }

    let payload: IdentityProofPayload;
    try {
      payload = await this.jwtService.verifyAsync<IdentityProofPayload>(proof, {
        secret,
        audience: 'auth-identity',
        issuer: 'platform-identity-adapter',
      });
    } catch {
      throw new UnauthorizedException('Invalid identity proof');
    }

    if (
      payload.token_use !== 'identity_proof' ||
      payload.provider !== expectedProvider ||
      !payload.sub ||
      !payload.jti ||
      !payload.exp ||
      (expectedActorId !== undefined && payload.actor_id !== expectedActorId)
    ) {
      throw new UnauthorizedException('Identity proof does not match request');
    }

    const proofHash = createHash('sha256').update(payload.jti).digest('hex');
    const subjectHash = createHash('sha256').update(payload.sub).digest('hex');
    try {
      await this.consumedProofs.insert({
        proof_hash: proofHash,
        provider: payload.provider,
        subject_hash: subjectHash,
        actor_id: payload.actor_id ?? null,
        expires_at: new Date(payload.exp * 1000),
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new UnauthorizedException('Identity proof was already consumed');
      }
      throw error;
    }

    return {
      proofId: payload.jti,
      provider: payload.provider,
      subject: payload.sub,
    };
  }

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const resolved = error as { code?: string; message?: string };
    return (
      resolved.code === '23505' ||
      String(resolved.message || '').includes('UNIQUE constraint failed')
    );
  }
}
