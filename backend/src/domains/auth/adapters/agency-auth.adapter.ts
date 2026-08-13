import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import type { AgencyAuthPort } from '../../agency';

@Injectable()
export class AgencyAuthAdapter implements AgencyAuthPort {
  constructor(private readonly authService: AuthService) {}

  lightRegister(deviceInfo: Record<string, unknown>) {
    return this.authService.lightRegister(deviceInfo);
  }
}
