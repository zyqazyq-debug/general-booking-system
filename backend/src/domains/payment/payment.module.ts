import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { CreditEscrow } from './entities/credit-escrow.entity';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { PaymentSucceededListener } from './listeners/payment-succeeded.listener';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentTransaction, CreditEscrow])],
  controllers: [PaymentController],
  providers: [PaymentService, MockPaymentProvider, PaymentSucceededListener],
  exports: [PaymentService],
})
export class PaymentModule {}
