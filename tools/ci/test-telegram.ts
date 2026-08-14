import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../backend/src/app.module';
import { TelegramService } from '../../../backend/src/platforms/telegram/bot/services/telegram.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const telegramService = app.get(TelegramService);

  const adminChatId = '1076287633';
  const h5BaseUrl = 'https://realzyq.synology.me';
  const detailUrl = `${h5BaseUrl}/#/pages/order/detail?id=TEST_ORDER_ID`;
  const listUrl = `${h5BaseUrl}/#/pages/order/list`;

  const summary = [
    '【预约订单通知】(测试)',
    '────────────────',
    `服务: 测试服务名称`,
    `服务者: 测试服务者`,
    `客户: 测试客户`,
    `时间: 2026/3/4 10:00:00 - 2026/3/4 11:00:00`,
    `时长: 60 分钟`,
    `原价: ¥100`,
    `成交价: ¥120`,
    `订单号: ORDER_TEST_001`,
  ].join('\n');

  console.log('Sending test message to', adminChatId);
  
  try {
    await telegramService.sendMessage(adminChatId, summary, {
        reply_markup: {
        inline_keyboard: [
            [
            { text: '查看订单详情', web_app: { url: detailUrl } },
            { text: '打开订单列表', web_app: { url: listUrl } },
            ],
        ],
        },
    });
    console.log('Message sent successfully');
  } catch (error) {
    console.error('Failed to send message', error);
  }

  // Exit immediately to avoid issues with Telegraf shutdown in webhook mode
  process.exit(0);
}

bootstrap();
