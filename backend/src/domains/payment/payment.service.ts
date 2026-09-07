import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { pessimisticWriteLockIfSupported } from '../../shared/common/database/lock.util';
import { BusinessErrorCode } from '../../shared/common/exceptions/business-error-code';
import { BusinessException } from '../../shared/common/exceptions/business.exception';
import { CreatePrepayDto } from './dto/create-prepay.dto';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import {
  PAYMENT_SETTLED_EVENT,
  type PaymentSettledEvent,
} from './events/payment-settled.event';
import { cnyMinorUnitsToDecimal, cnyToMinorUnits } from './money';
import {
  PaymentChannel,
  PaymentPurpose,
  PaymentTransactionStatus,
} from './payment.types';
import { PAYMENT_PROVIDER } from './ports/tokens';
import type { PaymentProvider } from './providers/payment-provider.interface';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepository: Repository<PaymentTransaction>,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  private normalizeChannel(channel: PaymentChannel): PaymentChannel {
    if (
      channel !== PaymentChannel.WECHAT &&
      channel !== PaymentChannel.ALIPAY
    ) {
      throw new BadRequestException('Unsupported payment channel');
    }

    return channel;
  }

  getChannels() {
    return [
      {
        channel: PaymentChannel.WECHAT,
        label: '微信支付',
        status: this.paymentProvider.isAvailable(PaymentChannel.WECHAT)
          ? 'active'
          : 'unavailable',
      },
      {
        channel: PaymentChannel.ALIPAY,
        label: '支付宝',
        status: this.paymentProvider.isAvailable(PaymentChannel.ALIPAY)
          ? 'active'
          : 'unavailable',
      },
    ];
  }

  async createPrepay(dto: CreatePrepayDto, userId: string) {
    const channel = this.normalizeChannel(dto.channel);
    if (!this.paymentProvider.isAvailable(channel)) {
      throw new ServiceUnavailableException(
        'No payment provider is configured for this channel',
      );
    }

    let amountMinor: number;
    try {
      amountMinor = cnyToMinorUnits(dto.amount);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid payment amount',
      );
    }

    this.logger.log(
      `Creating prepay for user ${userId}, amountMinor ${amountMinor}`,
    );

    const transaction = this.transactionRepository.create({
      user_id: userId,
      order_no: dto.order_no,
      amount: cnyMinorUnitsToDecimal(amountMinor),
      channel,
      status: PaymentTransactionStatus.PENDING,
      metadata: dto.metadata,
    });

    await this.transactionRepository.save(transaction);
    const result = await this.paymentProvider.createPrepay(dto);

    if (!result.success) {
      transaction.status = PaymentTransactionStatus.FAILED;
      transaction.error_message = result.error_message;
      await this.transactionRepository.save(transaction);
      throw BusinessException.badRequest({
        message: result.error_message || 'Payment initiation failed',
        error_code: BusinessErrorCode.PAYMENT_INIT_FAILED,
      });
    }

    return {
      transaction_id: transaction.id,
      order_no: transaction.order_no,
      amount_minor: amountMinor,
      currency: 'CNY' as const,
      ...result,
    };
  }

  async handleNotify(
    channelValue: PaymentChannel,
    body: unknown,
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    const channel = this.normalizeChannel(channelValue);
    this.logger.log(`Handling notify from channel ${channel}`);

    const result = await this.paymentProvider.verifyNotification(
      channel,
      body,
      headers,
    );

    if (!result.success) {
      this.logger.warn(
        `Notification verification failed: ${result.error_message}`,
      );
      return { success: false, message: result.error_message };
    }

    if (
      result.channel !== channel ||
      result.currency !== 'CNY' ||
      !result.trade_no ||
      !Number.isSafeInteger(result.amount_minor) ||
      result.amount_minor <= 0
    ) {
      throw new BadRequestException('Verified payment payload is invalid');
    }

    const settledEvent = await this.dataSource.transaction(
      async (manager): Promise<PaymentSettledEvent> => {
        const driverType = manager.connection.options.type;
        const transaction = await manager.findOne(PaymentTransaction, {
          where: { order_no: result.order_no, channel },
          ...pessimisticWriteLockIfSupported(driverType),
        });

        if (!transaction) {
          throw BusinessException.notFound({
            message: 'Transaction not found',
            error_code: BusinessErrorCode.PAYMENT_TRANSACTION_NOT_FOUND,
          });
        }

        const expectedAmountMinor = cnyToMinorUnits(transaction.amount);
        if (expectedAmountMinor !== result.amount_minor) {
          throw new BadRequestException(
            'Verified payment amount does not match the transaction',
          );
        }

        const tradeOwner = await manager.findOne(PaymentTransaction, {
          where: { trade_no: result.trade_no },
        });
        if (tradeOwner && tradeOwner.id !== transaction.id) {
          throw new BadRequestException(
            'Provider trade number is already bound to another transaction',
          );
        }

        if (
          transaction.status !== PaymentTransactionStatus.PENDING &&
          transaction.status !== PaymentTransactionStatus.SUCCESS
        ) {
          throw new BadRequestException(
            `Cannot settle a ${transaction.status} transaction`,
          );
        }

        if (
          transaction.status === PaymentTransactionStatus.SUCCESS &&
          transaction.trade_no !== result.trade_no
        ) {
          throw new BadRequestException(
            'Transaction is already bound to a different provider trade',
          );
        }

        transaction.status = PaymentTransactionStatus.SUCCESS;
        transaction.trade_no = result.trade_no;
        transaction.payment_event_id ||= randomUUID();
        transaction.metadata = {
          ...transaction.metadata,
          raw_notify: result.raw_data,
        };
        await manager.save(PaymentTransaction, transaction);

        return {
          eventVersion: 1,
          paymentEventId: transaction.payment_event_id,
          transactionId: transaction.id,
          payerUserId: transaction.user_id,
          orderNo: transaction.order_no,
          tradeNo: result.trade_no,
          channel,
          amountMinor: expectedAmountMinor,
          currency: 'CNY',
          // A client-supplied metadata field is never trusted as financial purpose.
          // A future server-owned payable resolver must replace UNKNOWN.
          purpose: PaymentPurpose.UNKNOWN,
          occurredAt: (transaction.updated_at ?? new Date()).toISOString(),
        };
      },
    );

    // Duplicate callbacks intentionally replay the same stable event id.
    // Every financial posting port must deduplicate on paymentEventId.
    await this.eventEmitter.emitAsync(PAYMENT_SETTLED_EVENT, settledEvent);

    return {
      success: true,
      payment_event_id: settledEvent?.paymentEventId,
    };
  }

  async getPaymentStatus(channelValue: PaymentChannel, orderNo: string) {
    const channel = this.normalizeChannel(channelValue);
    const transaction = await this.transactionRepository.findOne({
      where: { order_no: orderNo, channel },
    });

    if (!transaction) {
      throw new BadRequestException('Transaction not found');
    }

    return {
      order_no: orderNo,
      status: transaction.status,
      trade_no: transaction.trade_no,
      payment_event_id: transaction.payment_event_id,
    };
  }
}
