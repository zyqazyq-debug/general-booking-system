import { Update, Ctx, Action } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';
import { Logger } from '@nestjs/common';
import { TelegramErrorNormalizerService } from '../services/telegram-error-normalizer.service';
import { TelegramBookingApplicationService } from '../../application/telegram-booking.application.service';
import { TelegramCallbackService } from '../services/telegram-callback.service';

@Update()
export class TelegramBookingUpdate {
  private readonly logger = new Logger(TelegramBookingUpdate.name);

  constructor(
    private readonly bookingAppService: TelegramBookingApplicationService,
    private readonly errorNormalizer: TelegramErrorNormalizerService,
    private readonly callbackService: TelegramCallbackService,
  ) {}

  @Action(/^book_date_([a-f0-9-]+)_(.+)$/i)
  async onDateSelect(@Ctx() ctx: Context) {
    // @ts-expect-error Telegraf context with regex match
    const [, collectionId, dateStr] = ctx.match as string[];

    try {
      const { availableSlots } =
        await this.bookingAppService.getAvailableSlotsByCollection(
          collectionId,
          dateStr,
        );

      await this.callbackService.answerCbQuerySafely(
        ctx,
        '正在加载时间段...',
        'booking_date',
      );

      if (!availableSlots || availableSlots.length === 0) {
        await ctx.editMessageText(
          `📅 ${dateStr} 暂无可用时间段，请选择其他日期。`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🔙 返回日期选择',
                    callback_data: `book_${collectionId}`,
                  },
                ],
              ],
            },
          },
        );
        return;
      }

      // Format slots into grid of buttons (e.g. 3 columns)
      const buttons: InlineKeyboardButton[][] = [];
      let row: InlineKeyboardButton[] = [];
      for (const slot of availableSlots) {
        // slot is TimeSlot { start_time: string, end_time: string, status: 'available' | 'booked' }

        const date = new Date(slot.start_time);
        // Format HH:mm using local time (assuming server time is relevant for the service)
        // Or use UTC if that's the convention. Let's use getHours/getMinutes which use local time.
        const timeLabel = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

        // We pass timeLabel (HH:mm) back to callback
        const callbackData = `book_slot_${collectionId}_${dateStr}_${timeLabel}`;

        row.push({ text: timeLabel, callback_data: callbackData });

        if (row.length === 3) {
          buttons.push(row);
          row = [];
        }
      }
      if (row.length > 0) buttons.push(row);

      buttons.push([
        { text: '🔙 返回', callback_data: `book_${collectionId}` },
      ]);

      await ctx.editMessageText(`📅 **请选择预约时间** (${dateStr})`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons,
        },
      });
    } catch (e: unknown) {
      const errorText = this.errorNormalizer.extractErrorText(e, '未知错误');
      this.logger.error(
        `Failed to load slots for ${collectionId} on ${dateStr}: ${errorText}`,
      );
      await this.callbackService.answerCbQuerySafely(
        ctx,
        '加载失败',
        'booking_date',
      );
      await ctx.reply(`加载可用时间段失败: ${errorText}，请重试。`);
    }
  }

  @Action(/^book_slot_([a-f0-9-]+)_(.+)_(.+)$/i)
  async onSlotSelect(@Ctx() ctx: Context) {
    // @ts-expect-error Telegraf context with regex match
    const [, collectionId, dateStr, timeStr] = ctx.match as string[];
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    try {
      const { order, collection, endDateTime } =
        await this.bookingAppService.createBookingByCollectionSlot({
          chatId,
          collectionId,
          dateStr,
          timeStr,
        });

      await this.callbackService.answerCbQuerySafely(
        ctx,
        '预约成功！',
        'booking_slot',
      );
      await ctx.editMessageText(
        `✅ **预约成功**\n\n` +
          `订单号: \`${order.order_no}\`\n` +
          `服务: ${collection.alias || collection.service?.title || '服务'}\n` +
          `时间: ${dateStr} ${timeStr} - ${endDateTime.toTimeString().slice(0, 5)}\n` +
          `价格: ¥${order.display_price_snapshot}\n\n` +
          `请准时前往。`,
        { parse_mode: 'Markdown' },
      );
    } catch (e: unknown) {
      this.logger.error('Booking failed', e);
      const errorText = this.errorNormalizer.extractErrorText(e, '预约失败');
      let msg = '预约失败';
      if (errorText.includes('Credit')) msg = '信用分不足，请充值';
      if (errorText.includes('booked')) msg = '该时间段已被预约';

      await this.callbackService.answerCbQuerySafely(ctx, msg, 'booking_slot');
      await ctx.reply(`❌ ${msg}`);
    }
  }
}
