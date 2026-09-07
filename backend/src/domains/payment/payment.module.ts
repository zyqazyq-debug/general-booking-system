import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { CreditEscrow } from './entities/credit-escrow.entity';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { PaymentSucceededListener } from './listeners/payment-succeeded.listener';
import { UnavailablePaymentProvider } from './providers/unavailable-payment.provider';
import { PAYMENT_PROVIDER } from './ports/tokens';
import { PaymentChannel } from './payment.types';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentTransaction, CreditEscrow])],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    MockPaymentProvider,
    UnavailablePaymentProvider,
    PaymentSucceededListener,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (
        mockProvider: MockPaymentProvider,
        unavailableProvider: UnavailablePaymentProvider,
      ) =>
        mockProvider.isAvailable(PaymentChannel.WECHAT)
          ? mockProvider
          : unavailableProvider,
      inject: [MockPaymentProvider, UnavailablePaymentProvider],
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
