import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT } from '../events/social-login-succeeded.event';
import type { AuthSocialLoginSucceededEvent } from '../events/social-login-succeeded.event';

@Injectable()
export class SocialLoginListener {
  private readonly logger = new Logger(SocialLoginListener.name);

  @OnEvent(AUTH_SOCIAL_LOGIN_SUCCEEDED_EVENT)
  handleSocialLoginSucceeded(payload: AuthSocialLoginSucceededEvent) {
    const platform =
      typeof payload.deviceInfo?.platform === 'string'
        ? payload.deviceInfo.platform
        : 'unknown';
    this.logger.log(
      `version=${payload.eventVersion} requestId=${payload.requestId} proofId=${payload.proofId} provider=${payload.provider} userId=${payload.userId} username=${payload.username} platform=${platform} at=${payload.timestamp}`,
    );
  }
}
