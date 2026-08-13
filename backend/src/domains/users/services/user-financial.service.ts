import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { User } from '../entities/user.entity';
import { BusinessException } from '../../../shared/common/exceptions/business.exception';
import { BusinessErrorCode } from '../../../shared/common/exceptions/business-error-code';
import { pessimisticWriteLockIfSupported } from '../../../shared/common/database/lock.util';

@Injectable()
export class UserFinancialService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private emitCreditChanged(payload: {
    userId: string;
    action:
      | 'FREEZE'
      | 'UNFREEZE'
      | 'BURN'
      | 'ADJUST'
      | 'TRANSFER_OUT'
      | 'TRANSFER_IN';
    amount: number;
    creditBefore: number;
    creditAfter: number;
    frozenBefore: number;
    frozenAfter: number;
  }) {
    this.eventEmitter.emit('user.credit.changed', payload);
  }

  async freezeCredit(id: string, amount: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const driverType = repo.manager.connection.options.type;
    const user = await repo.findOne({
      where: { id },
      ...pessimisticWriteLockIfSupported(driverType),
    });

    if (!user) throw new NotFoundException('User not found');

    const available = new Decimal(user.credit_balance || 0);
    const required = new Decimal(amount || 0);

    if (available.lessThan(required)) {
      const shortfall = required.minus(available).toDecimalPlaces(2).toNumber();
      throw BusinessException.badRequest({
        message: 'Insufficient credit',
        error_code: BusinessErrorCode.INSUFFICIENT_CREDIT,
        details: {
          available_credit: available.toNumber(),
          required_credit: required.toNumber(),
          shortfall,
          purchase_endpoint: '/users/me/credit/purchase-intent',
        },
      });
    }

    const newBalance = available.minus(required);
    const newFrozen = new Decimal(user.frozen_credit || 0).plus(required);

    user.credit_balance = newBalance.toDecimalPlaces(2).toNumber();
    user.frozen_credit = newFrozen.toDecimalPlaces(2).toNumber();

    const saved = await repo.save(user);

    this.emitCreditChanged({
      userId: id,
      action: 'FREEZE',
      amount: required.toNumber(),
      creditBefore: available.toNumber(),
      creditAfter: saved.credit_balance,
      frozenBefore: newFrozen.minus(required).toNumber(),
      frozenAfter: saved.frozen_credit,
    });
    return saved;
  }

  async unfreezeCredit(id: string, amount: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const driverType = repo.manager.connection.options.type;
    const user = await repo.findOne({
      where: { id },
      ...pessimisticWriteLockIfSupported(driverType),
    });
    if (!user) throw new NotFoundException('User not found');

    let frozen = new Decimal(user.frozen_credit || 0);
    const toUnfreeze = new Decimal(amount || 0);

    if (
      frozen.lessThan(toUnfreeze) &&
      frozen.minus(toUnfreeze).abs().lessThan(0.01)
    ) {
      // Allow slight precision drift within 0.01 by treating it as exact match
      frozen = toUnfreeze;
    }

    if (frozen.lessThan(toUnfreeze)) {
      console.warn(
        `[Credit Fix] User ${id} frozen credit ${frozen.toString()} < ${toUnfreeze.toString()}.`,
      );
      throw new BadRequestException(
        `Data inconsistency: Not enough frozen credit (${frozen.toString()}) to unfreeze (${toUnfreeze.toString()})`,
      );
    }

    const newFrozen = frozen.minus(toUnfreeze);
    const newBalance = new Decimal(user.credit_balance || 0).plus(toUnfreeze);

    user.frozen_credit = newFrozen.toDecimalPlaces(2).toNumber();
    user.credit_balance = newBalance.toDecimalPlaces(2).toNumber();

    const saved = await repo.save(user);

    this.emitCreditChanged({
      userId: id,
      action: 'UNFREEZE',
      amount: toUnfreeze.toNumber(),
      creditBefore: newBalance.minus(toUnfreeze).toNumber(),
      creditAfter: saved.credit_balance,
      frozenBefore: newFrozen.plus(toUnfreeze).toNumber(),
      frozenAfter: saved.frozen_credit,
    });
    return saved;
  }

  async burnCredit(id: string, amount: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const driverType = repo.manager.connection.options.type;
    const user = await repo.findOne({
      where: { id },
      ...pessimisticWriteLockIfSupported(driverType),
    });

    if (!user) throw new NotFoundException('User not found');

    const currentFrozen = new Decimal(user.frozen_credit || 0);
    const toBurn = new Decimal(amount || 0);

    if (currentFrozen.lessThan(toBurn)) {
      throw new BadRequestException(
        `Insufficient frozen credit to burn (Current: ${currentFrozen.toString()}, Request: ${toBurn.toString()})`,
      );
    }

    const newFrozen = currentFrozen.minus(toBurn);
    user.frozen_credit = newFrozen.toDecimalPlaces(2).toNumber();

    const saved = await repo.save(user);

    this.emitCreditChanged({
      userId: id,
      action: 'BURN',
      amount: toBurn.toNumber(),
      creditBefore: Number(saved.credit_balance || 0),
      creditAfter: Number(saved.credit_balance || 0),
      frozenBefore: currentFrozen.toNumber(),
      frozenAfter: saved.frozen_credit,
    });
    return saved;
  }

  async addCredit(id: string, amount: number, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const driverType = repo.manager.connection.options.type;
    const user = await repo.findOne({
      where: { id },
      ...pessimisticWriteLockIfSupported(driverType),
    });

    if (!user) throw new NotFoundException('User not found');

    const before = new Decimal(user.credit_balance || 0);
    const toAdd = new Decimal(amount || 0);

    if (before.plus(toAdd).lessThan(0)) {
      throw new BadRequestException('Insufficient credit balance');
    }

    const newBalance = before.plus(toAdd);
    user.credit_balance = newBalance.toDecimalPlaces(2).toNumber();

    const saved = await repo.save(user);

    this.emitCreditChanged({
      userId: id,
      action: 'ADJUST',
      amount: toAdd.toNumber(),
      creditBefore: before.toNumber(),
      creditAfter: saved.credit_balance,
      frozenBefore: Number(saved.frozen_credit || 0),
      frozenAfter: Number(saved.frozen_credit || 0),
    });
    return saved;
  }

  async transferFrozenCredit(
    fromUserId: string,
    toUserId: string,
    amount: number,
    manager: EntityManager,
  ) {
    const userRepo = manager.getRepository(User);
    const driverType = userRepo.manager.connection.options.type;
    const fromUser = await userRepo.findOne({
      where: { id: fromUserId },
      ...pessimisticWriteLockIfSupported(driverType),
    });
    const toUser = await userRepo.findOne({
      where: { id: toUserId },
      ...pessimisticWriteLockIfSupported(driverType),
    });

    if (!fromUser || !toUser) throw new NotFoundException('User not found');

    const transferAmount = new Decimal(amount || 0);
    const fromFrozenBefore = new Decimal(fromUser.frozen_credit || 0);
    const toCreditBefore = new Decimal(toUser.credit_balance || 0);

    if (fromFrozenBefore.lessThan(transferAmount)) {
      throw new BadRequestException('Insufficient frozen credit');
    }

    const newFromFrozen = fromFrozenBefore.minus(transferAmount);
    fromUser.frozen_credit = newFromFrozen.toDecimalPlaces(2).toNumber();
    await userRepo.save(fromUser);

    this.emitCreditChanged({
      userId: fromUserId,
      action: 'TRANSFER_OUT',
      amount: transferAmount.toNumber(),
      creditBefore: Number(fromUser.credit_balance || 0),
      creditAfter: Number(fromUser.credit_balance || 0),
      frozenBefore: fromFrozenBefore.toNumber(),
      frozenAfter: fromUser.frozen_credit,
    });

    const newToBalance = toCreditBefore.plus(transferAmount);
    toUser.credit_balance = newToBalance.toDecimalPlaces(2).toNumber();
    await userRepo.save(toUser);

    this.emitCreditChanged({
      userId: toUserId,
      action: 'TRANSFER_IN',
      amount: transferAmount.toNumber(),
      creditBefore: toCreditBefore.toNumber(),
      creditAfter: toUser.credit_balance,
      frozenBefore: Number(toUser.frozen_credit || 0),
      frozenAfter: Number(toUser.frozen_credit || 0),
    });
  }

  createCreditPurchaseIntent(userId: string, requiredCredit = 0) {
    const required = Number(Math.max(0, requiredCredit).toFixed(2));
    return {
      status: 'PENDING_INTEGRATION',
      user_id: userId,
      required_credit: required,
      suggested_packages: [100, 200, 500],
      purchase_url: null,
      message: 'Credit purchase API placeholder',
    };
  }
}
