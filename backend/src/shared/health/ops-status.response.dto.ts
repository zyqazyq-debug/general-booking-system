import { ApiProperty } from '@nestjs/swagger';

/** Public, non-secret identity shared by release probes. */
class ReleaseIdentityResponseDto {
  @ApiProperty({ example: 'booking-20260909T000000Z-abcdef123456' })
  releaseId: string;

  @ApiProperty({ example: 'abcdef1234567890abcdef1234567890abcdef12' })
  gitSha: string;

  @ApiProperty({
    example:
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  manifestDigest: string;

  @ApiProperty({ enum: ['blue', 'green', 'unbound'], example: 'green' })
  slot: string;

  @ApiProperty({ example: 'booking.config/v1' })
  configSchema: string;

  @ApiProperty({ example: '1788740000000-AddOrderSourceIdempotencyKey' })
  migrationFloor: string;

  @ApiProperty({
    example:
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  migrationCatalogDigest: string;

  @ApiProperty({ enum: ['webhook', 'polling', 'disabled'] })
  telegramBotMode: string;

  @ApiProperty({ type: Boolean })
  telegramWebhookEnabled: boolean;

  @ApiProperty({ example: 'https://app.example/telegram/webhook' })
  telegramWebhookUrl: string;
}

export class OpsLivenessResponseDto extends ReleaseIdentityResponseDto {
  @ApiProperty({ enum: ['up'], example: 'up' })
  status: 'up';
}

export class OpsReadinessResponseDto extends ReleaseIdentityResponseDto {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status: 'ready';
}

export class OpsNotReadyResponseDto {
  @ApiProperty({ enum: ['not-ready'], example: 'not-ready' })
  status: 'not-ready';
}
