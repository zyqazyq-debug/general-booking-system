import { Controller, Get, Param } from '@nestjs/common';
import { AgencyService } from './agency.service';

@Controller('agency')
export class AgencyPublicReadController {
  constructor(private readonly agencyService: AgencyService) {}

  @Get('slug/:slug')
  async resolveBySlug(@Param('slug') slug: string) {
    return this.agencyService.findBySlug(slug);
  }

  @Get('s/:slug')
  async resolveByShortSlug(@Param('slug') slug: string) {
    return this.agencyService.findBySlug(slug);
  }
}
