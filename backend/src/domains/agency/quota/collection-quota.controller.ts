import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth';
import { CollectionQuotaService } from './collection-quota.service';
import { CreateCollectionQuotaPurchaseIntentDto } from './dto/create-collection-quota-purchase-intent.dto';
import type { AuthenticatedRequest } from '../../../shared/common/types/auth-request.type';

@Controller('agency/collection-quota')
@UseGuards(JwtAuthGuard)
export class CollectionQuotaController {
  constructor(
    private readonly collectionQuotaService: CollectionQuotaService,
  ) {}

  @Get()
  async getQuota(@Request() req: AuthenticatedRequest) {
    return this.collectionQuotaService.getQuota(req.user.id);
  }

  @Post('purchase-intent')
  async createPurchaseIntent(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateCollectionQuotaPurchaseIntentDto,
  ) {
    return this.collectionQuotaService.createPurchaseIntent(req.user.id, dto);
  }
}
