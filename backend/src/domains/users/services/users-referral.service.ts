import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

const REFERRAL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateReferralCode = () => {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return `R${out}`;
};

@Injectable()
export class UsersReferralService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  normalizeReferralCode(raw?: string | null) {
    return (raw || '').trim().toUpperCase();
  }

  async buildUniqueReferralCode() {
    for (let i = 0; i < 12; i++) {
      const candidate = String(generateReferralCode())
        .toUpperCase()
        .replace(/[^2-9A-Z]/g, '')
        .slice(0, 7);
      if (candidate.length !== 7 || !candidate.startsWith('R')) {
        continue;
      }
      const existing = await this.usersRepository.findOneBy({
        referral_code: candidate,
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new BadRequestException('Referral code generation failed');
  }

  async ensureReferralCode(user: User | null) {
    if (!user) {
      return null;
    }
    if (user.referral_code) {
      return user;
    }
    user.referral_code = await this.buildUniqueReferralCode();
    return this.usersRepository.save(user);
  }

  findByReferralCode(referralCode: string) {
    const normalized = this.normalizeReferralCode(referralCode);
    if (!normalized) {
      return null;
    }
    return this.usersRepository.findOneBy({ referral_code: normalized });
  }
}
