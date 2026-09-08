import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AgencyService } from './agency.service';
import { PublicAgencyNodeViewEnvelopeDto } from './dto/agency-response.dto';

@Controller('agency')
export class AgencyPublicReadController {
  constructor(private readonly agencyService: AgencyService) {}

  @Get('slug/:slug')
  @ApiOkResponse({ type: PublicAgencyNodeViewEnvelopeDto })
  async resolveBySlug(@Param('slug') slug: string) {
    return this.agencyService.findBySlug(slug);
  }

  @Get('s/:slug')
  @ApiOkResponse({ type: PublicAgencyNodeViewEnvelopeDto })
  async resolveByShortSlug(@Param('slug') slug: string) {
    return this.agencyService.findBySlug(slug);
  }
}
