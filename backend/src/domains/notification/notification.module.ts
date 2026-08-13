import { Module } from '@nestjs/common';
import { TelegramChannel } from './channels/telegram.channel';
import { NotificationListener } from './listeners/notification.listener';
import { NotificationService } from './notification.service';
import { TelegramCoreModule } from '../../platforms/telegram';
import { OrderNotificationAdapter } from './adapters/order-notification.adapter';

@Module({
  imports: [TelegramCoreModule],
  providers: [
    TelegramChannel,
    NotificationListener,
    NotificationService,
    OrderNotificationAdapter,
  ],
  exports: [NotificationService, TelegramChannel, OrderNotificationAdapter],
})
export class NotificationModule {}
