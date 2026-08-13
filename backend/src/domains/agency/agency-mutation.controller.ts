import {
  BadRequestException,
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
    @Body('is_active') isActive: boolean | string,
  ) {
    const active =
      typeof isActive === 'string' ? isActive === 'true' : isActive;

    if (typeof active !== 'boolean') {
      throw new BadRequestException('is_active must be boolean');
    }

    return this.agencyService.setCollectionStatus(req.user.id, id, active);
  }

  @Patch('collection/:id/reparent')
  @UseGuards(JwtAuthGuard)
  async reparentCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('newParentNodeId') newParentNodeId: string,
  ) {
    if (!newParentNodeId) {
      throw new BadRequestException('newParentNodeId is required');
    }

    return this.agencyService.reparentCollection(
      req.user.id,
      id,
      newParentNodeId,
    );
  }

  @Patch('collection/:id')
  @UseGuards(JwtAuthGuard)
  async updateCollection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      markup_amount?: number;
      private_notes?: string;
      public_notes?: string;
      markup_type?: string;
      markup_value?: number;
      alias?: string;
    },
  ) {
    return this.agencyService.updateCollection(req.user.id, id, body);
  }
}
