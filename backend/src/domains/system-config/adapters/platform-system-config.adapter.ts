import { Injectable } from '@nestjs/common';

import { SystemConfigService } from '../system-config.service';

@Injectable()
export class PlatformSystemConfigAdapter {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  get<T>(key: string, defaultValue?: T): Promise<T> {
    return this.systemConfigService.get<T>(key, defaultValue);
  }
}
