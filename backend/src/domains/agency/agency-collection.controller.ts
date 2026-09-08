import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AgencyService } from './agency.service';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import { ApiOkResponse } from '@nestjs/swagger';
import { AgencyCollectionEnvelopeDto, AgencyNodeViewEnvelopeDto, CollectionAvailabilityEnvelopeDto } from './dto/agency-response.dto';

@Controller('agency')
export class AgencyCollectionController {
  constructor(private readonly agencyService: AgencyService) {}

  @Get('collection')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: AgencyCollectionEnvelopeDto })
  async getMyCollection(@Request() req: AuthenticatedRequest) {
    return this.agencyService.getMyCollection(req.user.id);
  }

  @Get('collection/availability')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: CollectionAvailabilityEnvelopeDto })
  async getCollectionAvailability(
    @Request() req: AuthenticatedRequest,
    @Query('date') date: string,
  ) {
    return this.agencyService.getCollectionAvailability(req.user.id, date);
  }

  @Get('nodes/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: AgencyNodeViewEnvelopeDto })
  async getNodeById(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.agencyService.findByIdForActor(id, req.user.id);
  }
}
