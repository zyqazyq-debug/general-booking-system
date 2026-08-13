import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenService } from './auth-token.service';
import { TELEGRAM_VALIDATOR } from '../interfaces/telegram-validator.interface';
import type {
  ITelegramValidator,
  TelegramAuthData,
  TelegramBotProfile,
} from '../interfaces/telegram-validator.interface';
import type { AuthUsersPort } from '../ports/auth-users.port';
import { AUTH_USERS_PORT } from '../ports/tokens';
import type {
  BindingStatusResponse,
  LoginResponse,
  ScanIdentityProvider,
} from '../auth.types';

@Injectable()
export class AuthTelegramLoginService {
  private readonly logger = new Logger(AuthTelegramLoginService.name);

  constructor(
    @Inject(AUTH_USERS_PORT)
    private readonly usersPort: AuthUsersPort,
    private readonly authTokenService: AuthTokenService,
    private readonly configService: ConfigService,
    @Inject(TELEGRAM_VALIDATOR)
    private readonly telegramValidator: ITelegramValidator,
  ) {}

  async loginTelegram(
    authData: TelegramAuthData,
    deviceInfo: Record<string, unknown> = {},
  ): Promise<LoginResponse> {
    const { hash: _hash, ...data } = authData;
    void _hash;

    // Use validator to throw exception if invalid
    this.telegramValidator.validateBotData(authData);

    const telegramId = data.id.toString();
    this.logger.log(`[Telegram Login] source=bot telegram=${telegramId}`);
    let user = await this.usersPort.findByTelegram(telegramId);

    if (!user) {
      user = await this.usersPort.createWithProvider({
        username: `tg_${telegramId}_${Math.random().toString(36).substring(7)}`,
        telegram_chat_id: telegramId,
        telegram_username: data.username || '',
        nickname: [data.first_name, data.last_name].filter(Boolean).join(' '),
        avatar: data.photo_url || '',
        is_verified: true,
      });
    }

    return this.authTokenService.login(user, deviceInfo);
  }

  async loginTelegramWebApp(initData: string): Promise<LoginResponse> {
    const tgData = this.telegramValidator.validateWebAppData(initData);
    this.logger.log(
      `[Telegram Login] source=webapp telegram=${tgData.telegramId}`,
    );

    let user = await this.usersPort.findByTelegram(tgData.telegramId);
    if (!user) {
      user = await this.usersPort.createWithProvider({
        username: `tg_${tgData.telegramId}_${Math.random().toString(36).substring(7)}`,
        telegram_chat_id: tgData.telegramId,
        telegram_username: tgData.username,
        nickname: [tgData.firstName, tgData.lastName].filter(Boolean).join(' '),
        avatar: tgData.photoUrl,
        is_verified: true,
      });
    }

    this.logger.log(
      `[WebApp Access] User ${user.nickname} (${user.id}) opened Mini App via Telegram.`,
    );
    return this.authTokenService.login(user);
  }

  async startIdentityScanBinding(
    userId: string,
    provider: ScanIdentityProvider,
  ) {
    if (provider === 'telegram') {
      const token = this.telegramValidator.generateLoginToken(userId);
      const link = await this.telegramValidator.getBotDeepLink(token);
      const botInfo = await this.telegramValidator.getBotInfo();
      return {
        status: 'ready',
        provider,
        ticket_id: token,
        qr_url: link,
        expires_in: 600,
        message: '请点击链接或扫描二维码跳转到 Telegram 机器人完成绑定',
        extra: {
          bot_username: botInfo.username,
          bot_name: botInfo.first_name,
        },
      };
    }

    const ticketId = `scan_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      status: 'reserved',
      user_id: userId,
      provider,
      ticket_id: ticketId,
      qr_url: '',
      expires_in: 300,
      message: `${provider} 扫码绑定接口已预留，待接入官方扫码授权`,
    };
  }

  async generateTelegramLoginTicket() {
    const token = this.telegramValidator.generateLoginToken();
    const botDeepLink = await this.telegramValidator.getBotDeepLink(token);
    return {
      ticket_id: token,
      bot_url: botDeepLink,
      expires_in: 600,
    };
  }

  async loginByChatId(
    chatId: string,
    telegramUser?: TelegramBotProfile,
  ): Promise<LoginResponse> {
    let user = await this.usersPort.findByTelegram(chatId);
    if (!user) {
      user = await this.usersPort.createWithProvider({
        username: `tg_${chatId}_${Math.random().toString(36).substring(7)}`,
        telegram_chat_id: chatId,
        telegram_username: telegramUser?.username || '',
        nickname: [telegramUser?.first_name, telegramUser?.last_name]
          .filter(Boolean)
          .join(' '),
        avatar: telegramUser?.photo_url || '',
        is_verified: true,
      });
    }
    return this.authTokenService.login(user);
  }

  checkIdentityScanBindingStatus(ticketId: string): BindingStatusResponse {
    if (ticketId.startsWith('bt_') || ticketId.startsWith('lt_')) {
      const res = this.telegramValidator.getTokenStatus(ticketId);
      if (res.status === 'success') {
        return {
          status: 'success',
          ticket_id: ticketId,
          message: 'Telegram 绑定成功',
          ...(res.result as Record<string, unknown>),
        };
      }
      return {
        status: res.status === 'pending' ? 'pending' : 'expired',
        ticket_id: ticketId,
        message:
          res.status === 'pending'
            ? '等待用户在 Telegram 中确认...'
            : '绑定链接已失效',
      };
    }

    return {
      status: 'pending',
      ticket_id: ticketId,
      message: '扫码授权状态查询接口已预留，待接入官方回调',
    };
  }
}
