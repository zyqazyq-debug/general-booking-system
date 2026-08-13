import { Injectable } from '@nestjs/common';
import { AgencyService } from '../agency.service';
import type { AdminAgencyPort } from '../../admin';

@Injectable()
export class AdminAgencyAdapter implements AdminAgencyPort {
  constructor(private readonly agencyService: AgencyService) {}

  findAll(): Promise<unknown> {
    return this.agencyService.findAll();
  }
}
