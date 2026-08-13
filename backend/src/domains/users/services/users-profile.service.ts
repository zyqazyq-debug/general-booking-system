import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { User } from '../entities/user.entity';
import {
  PaginatedResponseDto,
  PaginationDto,
} from '../../../shared/common/dto/pagination.dto';
import { BusinessErrorCode } from '../../../shared/common/exceptions/business-error-code';
import { BusinessException } from '../../../shared/common/exceptions/business.exception';
import { UsersReferralService } from './users-referral.service';

@Injectable()
export class UsersProfileService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly usersReferralService: UsersReferralService,
  ) {}

  private async hashPassword(rawPassword: string) {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(rawPassword, salt);
  }

  async create(createUserDto: CreateUserDto) {
    const normalizedEmail = createUserDto.email?.trim().toLowerCase() || null;

    if (normalizedEmail) {
      const existingByEmail = await this.usersRepository.findOneBy({
        email: normalizedEmail,
      });
      if (existingByEmail) {
        throw new BadRequestException('Email exists');
      }
    }

    const referralCode =
      await this.usersReferralService.buildUniqueReferralCode();
    const hashedPassword = await this.hashPassword(createUserDto.password);
    const user = this.usersRepository.create({
      ...createUserDto,
      email: normalizedEmail,
      password: hashedPassword,
      referral_code: referralCode,
    });
    return this.usersRepository.save(user);
  }

  async findAll(
    paginationDto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<User>> {
    const { page = 1, limit = 10 } = paginationDto;
    const normalizedPage = Math.max(1, page);
    const skip = (normalizedPage - 1) * limit;

    const [data, total] = await this.usersRepository.findAndCount({
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page: normalizedPage,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.usersRepository.findOneBy({ id });
    return this.usersReferralService.ensureReferralCode(user);
  }

  save(user: User) {
    return this.usersRepository.save(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updateUserDto.username && updateUserDto.username !== user.username) {
      const existingByUsername = await this.usersRepository.findOneBy({
        username: updateUserDto.username,
      });
      if (existingByUsername && existingByUsername.id !== id) {
        throw BusinessException.badRequest({
          message: 'Username exists',
          error_code: BusinessErrorCode.USERNAME_EXISTS,
        });
      }
    }

    const normalizedEmail =
      updateUserDto.email !== undefined
        ? updateUserDto.email?.trim().toLowerCase() || null
        : undefined;

    if (normalizedEmail) {
      const existingByEmail = await this.usersRepository.findOneBy({
        email: normalizedEmail,
      });
      if (existingByEmail && existingByEmail.id !== id) {
        throw BusinessException.badRequest({
          message: 'Email exists',
          error_code: BusinessErrorCode.EMAIL_EXISTS,
        });
      }
    }

    if (updateUserDto.roles) {
      user.roles = Array.from(new Set(updateUserDto.roles));
    }

    if (updateUserDto.password) {
      user.password = await this.hashPassword(updateUserDto.password);
    }

    const {
      password: _pw,
      roles: _rl,
      referrer_id: _ri,
      referral_code: _rc,
      wallet_balance: _wb,
      credit_balance: _cb,
      frozen_credit: _fc,
      id: _id,
      ...allowedFields
    } = updateUserDto as Record<string, unknown>;
    void _pw;
    void _rl;
    void _ri;
    void _rc;
    void _wb;
    void _cb;
    void _fc;
    void _id;

    Object.assign(user, allowedFields);
    if (normalizedEmail !== undefined) {
      user.email = normalizedEmail;
    }

    return this.usersRepository.save(user);
  }

  async addRole(id: string, role: string) {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.roles.includes(role)) {
      return user;
    }
    user.roles.push(role);
    return this.usersRepository.save(user);
  }

  async changePassword(id: string, oldPass: string, newPass: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
      select: ['id', 'password'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(oldPass, user.password);
    if (!isMatch) {
      throw BusinessException.badRequest({
        message: 'Old password incorrect',
        error_code: BusinessErrorCode.OLD_PASSWORD_INCORRECT,
      });
    }

    await this.usersRepository.update(id, {
      password: await this.hashPassword(newPass),
    });
    return { success: true };
  }

  remove(id: string) {
    return this.usersRepository.delete(id);
  }
}
