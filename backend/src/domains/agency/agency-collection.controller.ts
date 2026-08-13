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

@Controller('agency')
export class AgencyCollectionController {
  constructor(private readonly agencyService: AgencyService) {}

  @Get('collection')
  @UseGuards(JwtAuthGuard)
  async getMyCollection(@Request() req: AuthenticatedRequest) {
    return this.agencyService.getMyCollection(req.user.id);
  }

  @Get('collection/availability')
  @UseGuards(JwtAuthGuard)
  async getCollectionAvailability(
    @Request() req: AuthenticatedRequest,
    @Query('date') date: string,
  ) {
    return this.agencyService.getCollectionAvailability(req.user.id, date);
  }

  @Get('nodes/:id')
  @UseGuards(JwtAuthGuard)
  async getNodeById(@Param('id') id: string) {
    return this.agencyService.findById(id);
  }
}
