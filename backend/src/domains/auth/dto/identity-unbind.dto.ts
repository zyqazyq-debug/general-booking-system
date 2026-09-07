import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { ScanIdentityProvider } from '../auth.types';

const SCAN_IDENTITY_PROVIDERS = ['wechat', 'qq', 'telegram'] as const;

export class IdentityUnbindDto {
  @IsIn(SCAN_IDENTITY_PROVIDERS)
  @ApiProperty({ enum: SCAN_IDENTITY_PROVIDERS })
  provider: ScanIdentityProvider;
}
