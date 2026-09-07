import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AgencyService } from './agency.service';
import { JwtAuthGuard } from '../auth';
import type { AuthenticatedRequest } from '../../shared/common/types/auth-request.type';
import {
  ReparentCollectionDto,
  SetCollectionStatusDto,
  UpdateCollectionDto,
} from './dto/collection-mutation.dto';

@Controller('agency')
export class AgencyMutationController {
  constructor(private readonly agencyService: AgencyService) {}

  @Delete('collection/:id')
  @UseGuards(JwtAuthGuard)
  async removeFromCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.agencyService.removeCollection(req.user.id, id);
  }

  @Patch('collection/:id/status')
  @UseGuards(JwtAuthGuard)
  async setCollectionStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SetCollectionStatusDto,
  ) {
    return this.agencyService.setCollectionStatus(
      req.user.id,
      id,
      body.is_active,
    );
  }

  @Patch('collection/:id/reparent')
  @UseGuards(JwtAuthGuard)
  async reparentCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: ReparentCollectionDto,
  ) {
    return this.agencyService.reparentCollection(
      req.user.id,
      id,
      body.newParentNodeId,
    );
  }

  @Patch('collection/:id')
  @UseGuards(JwtAuthGuard)
  async updateCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateCollectionDto,
  ) {
    return this.agencyService.updateCollection(req.user.id, id, body);
  }
}
