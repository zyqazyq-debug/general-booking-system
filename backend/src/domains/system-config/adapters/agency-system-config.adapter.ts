import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../system-config.service';
import type { AgencySystemConfigPort } from '../../agency';

@Injectable()
export class AgencySystemConfigAdapter implements AgencySystemConfigPort {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  async getNumber(key: string, defaultValue: number): Promise<number> {
    return this.systemConfigService.get<number>(key, defaultValue);
  }
}
