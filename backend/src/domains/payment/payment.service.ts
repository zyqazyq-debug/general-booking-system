import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreatePrepayDto } from './dto/create-prepay.dto';
import { PaymentChannel, PaymentTransactionStatus } from './payment.types';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BusinessException } from '../../shared/common/exceptions/business.exception';
import { BusinessErrorCode } from '../../shared/common/exceptions/business-error-code';
import { pessimisticWriteLockIfSupported } from '../../shared/common/database/lock.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepository: Repository<PaymentTransaction>,
    private readonly mockProvider: MockPaymentProvider,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  private toEntityChannel(channel: PaymentChannel): PaymentChannel {
    if (channel === PaymentChannel.WECHAT) {
      return PaymentChannel.WECHAT;
    }
    return PaymentChannel.ALIPAY;
  }

  getChannels() {
    return [
      {
        channel: PaymentChannel.WECHAT,
        label: '微信支付',
        status: 'active', // Changed to active as we have mock
      },
      {
        channel: PaymentChannel.ALIPAY,
        label: '支付宝',
        status: 'active',
      },
    ];
  }

  async createPrepay(dto: CreatePrepayDto, userId: string) {
    this.logger.log(`Creating prepay for user ${userId}, amount ${dto.amount}`);

    // 1. Create transaction record
    const transaction = this.transactionRepository.create({
      user_id: userId,
      order_no: dto.order_no,
      amount: dto.amount,
      channel: this.toEntityChannel(dto.channel),
      status: PaymentTransactionStatus.PENDING,
      metadata: dto.metadata,
    });

    await this.transactionRepository.save(transaction);

    // 2. Call provider (using mock for now)
    const result = await this.mockProvider.createPrepay(dto);

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
      amount: transaction.amount,
      ...result,
    };
  }

  async handleNotify(channel: PaymentChannel, body: unknown) {
    this.logger.log(`Handling notify from channel ${channel}`);

    // 1. Verify notification (mock for now)
    const result = await this.mockProvider.verifyNotification(body);

    if (!result.success) {
      this.logger.error(
        `Notification verification failed: ${result.error_message}`,
      );
      return { success: false, message: result.error_message };
    }

    let shouldEmit = false;
    let payload: {
      userId: string;
      amount: number;
      orderNo: string;
      tradeNo: string;
      transactionId: string;
    } | null = null;

    await this.dataSource.transaction(async (manager) => {
      const driverType = manager.connection.options.type;
      const transaction = await manager.findOne(PaymentTransaction, {
        where: { order_no: result.order_no },
        ...pessimisticWriteLockIfSupported(driverType),
      });

      if (!transaction) {
        this.logger.error(
          `Transaction not found for order_no: ${result.order_no}`,
        );
        throw BusinessException.notFound({
          message: 'Transaction not found',
          error_code: BusinessErrorCode.PAYMENT_TRANSACTION_NOT_FOUND,
        });
      }

      if (transaction.status === PaymentTransactionStatus.SUCCESS) {
        return;
      }

      transaction.status = PaymentTransactionStatus.SUCCESS;
      transaction.trade_no = result.trade_no;
      transaction.metadata = {
        ...transaction.metadata,
        raw_notify: result.raw_data,
      };
      await manager.save(PaymentTransaction, transaction);
      shouldEmit = true;
      payload = {
        userId: transaction.user_id,
        amount: transaction.amount,
        orderNo: transaction.order_no,
        tradeNo: transaction.trade_no || result.trade_no,
        transactionId: transaction.id,
      };
    });

    if (shouldEmit && payload) {
      this.eventEmitter.emit('payment.succeeded', payload);
    }

    return { success: true };
  }

  async getPaymentStatus(channel: PaymentChannel, orderNo: string) {
    const transaction = await this.transactionRepository.findOne({
      where: { order_no: orderNo, channel: this.toEntityChannel(channel) },
    });

    if (!transaction) {
      throw new BadRequestException('Transaction not found');
    }

    return {
      order_no: orderNo,
      status: transaction.status,
      trade_no: transaction.trade_no,
    };
  }
}
