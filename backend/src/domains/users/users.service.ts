import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import {
  PaginationDto,
  PaginatedResponseDto,
} from '../../shared/common/dto/pagination.dto';
import { UserFinancialService } from './services/user-financial.service';
import { UserTokenService } from './services/user-token.service';
import { UsersProfileService } from './services/users-profile.service';
import { UsersIdentityService } from './services/users-identity.service';
import { UsersReferralService } from './services/users-referral.service';

type TelegramUserProfile = {
  username?: string;
  first_name?: string;
  last_name?: string;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly usersProfileService: UsersProfileService,
    private readonly usersIdentityService: UsersIdentityService,
    private readonly usersReferralService: UsersReferralService,
    private readonly userFinancialService: UserFinancialService,
    private readonly userTokenService: UserTokenService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    return this.usersProfileService.create(createUserDto);
  }

  async findAll(
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<User>> {
    return this.usersProfileService.findAll(paginationDto);
  }

  async findOne(id: string) {
    return this.usersProfileService.findOne(id);
  }

  findByUsername(username: string) {
    return this.usersIdentityService.findByUsername(username);
  }

  findByEmail(email: string) {
    return this.usersIdentityService.findByEmail(email);
  }

  findByReferralCode(referralCode: string) {
    return this.usersReferralService.findByReferralCode(referralCode);
  }

  // Find user with password for authentication
  async findForAuth(usernameOrPhone: string) {
    return this.usersIdentityService.findForAuth(usernameOrPhone);
  }

  async findByIdForAuth(id: string) {
    return this.usersIdentityService.findByIdForAuth(id);
  }

  async save(user: User) {
    return this.usersProfileService.save(user);
  }

  findByWechat(openid: string) {
    return this.usersIdentityService.findByWechat(openid);
  }

  findByWechatAny(openid: string) {
    return this.usersIdentityService.findByWechatAny(openid);
  }

  findByTelegram(telegramId: string) {
    return this.usersIdentityService.findByTelegram(telegramId);
  }

  findByQQ(openid: string) {
    return this.usersIdentityService.findByQQ(openid);
  }

  findByQQAny(openid: string) {
    return this.usersIdentityService.findByQQAny(openid);
  }

  findByPhone(phone: string) {
    return this.usersIdentityService.findByPhone(phone);
  }

  async createWithProvider(data: Partial<User>) {
    return this.usersIdentityService.createWithProvider(data);
  }

  async syncTelegramUser(
    userOrChatId: string | User,
    telegramUser: TelegramUserProfile | null,
  ) {
    return this.usersIdentityService.syncTelegramUser(
      userOrChatId,
      telegramUser,
    );
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    return this.usersProfileService.update(id, updateUserDto);
  }

  async addRole(id: string, role: string) {
    return this.usersProfileService.addRole(id, role);
  }

  // Support transactional EntityManager
  async freezeCredit(id: string, amount: number, manager?: EntityManager) {
    return this.userFinancialService.freezeCredit(id, amount, manager);
  }

  async unfreezeCredit(id: string, amount: number, manager?: EntityManager) {
    return this.userFinancialService.unfreezeCredit(id, amount, manager);
  }

  async burnCredit(id: string, amount: number, manager?: EntityManager) {
    return this.userFinancialService.burnCredit(id, amount, manager);
  }

  async addCredit(id: string, amount: number, manager?: EntityManager) {
    return this.userFinancialService.addCredit(id, amount, manager);
  }

  async transferFrozenCredit(
    fromUserId: string,
    toUserId: string,
    amount: number,
    manager: EntityManager,
  ) {
    return this.userFinancialService.transferFrozenCredit(
      fromUserId,
      toUserId,
      amount,
      manager,
    );
  }

  async changePassword(id: string, oldPass: string, newPass: string) {
    return this.usersProfileService.changePassword(id, oldPass, newPass);
  }

  remove(id: string) {
    return this.usersProfileService.remove(id);
  }

  createCreditPurchaseIntent(userId: string, requiredCredit = 0) {
    return this.userFinancialService.createCreditPurchaseIntent(
      userId,
      requiredCredit,
    );
  }

  // --- Token Management ---

  async addRefreshToken(
    userId: string,
    token: string,
    expiresAt: Date,
    deviceInfo: Record<string, unknown> = {},
  ) {
    return this.userTokenService.addRefreshToken(
      userId,
      token,
      expiresAt,
      deviceInfo,
    );
  }

  async validateRefreshToken(token: string) {
    return this.userTokenService.validateRefreshToken(token);
  }

  async removeRefreshToken(token: string) {
    return this.userTokenService.removeRefreshToken(token);
  }

  async removeAllRefreshTokens(userId: string) {
    return this.userTokenService.removeAllRefreshTokens(userId);
  }

  async rotateRefreshToken(
    oldToken: string,
    newToken: string,
    expiresAt: Date,
  ) {
    return this.userTokenService.rotateRefreshToken(
      oldToken,
      newToken,
      expiresAt,
    );
  }

  async cleanupAllExpiredTokens() {
    return this.userTokenService.cleanupAllExpiredTokens();
  }
}
