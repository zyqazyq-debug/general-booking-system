import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AgencyService } from './agency.service';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth';
import type {
  AuthenticatedRequest,
  OptionalAuthenticatedRequest,
} from '../../shared/common/types/auth-request.type';
import { CreateAgencyNodeDto } from './dto/create-agency-node.dto';
import { AgencyOnboardingFacade } from './services/agency-onboarding.facade';
import {
  ExecuteImportDto,
  UpdateCollectionDto,
} from './dto/collection-mutation.dto';
import { ApiCreatedResponse, ApiExtraModels, ApiOkResponse } from '@nestjs/swagger';
import { AgencyCreationEnvelopeDto, AgencyNodeResponseDto, AgencyOnboardingEnvelopeDto, AuthenticatedBatchImportResponseDataDto, AuthenticatedCollectionResponseDataDto, BatchImportResultResponseDto, PreCheckImportEnvelopeDto } from './dto/agency-response.dto';

@Controller('agency')
@ApiExtraModels(AgencyNodeResponseDto, BatchImportResultResponseDto, AuthenticatedCollectionResponseDataDto, AuthenticatedBatchImportResponseDataDto)
export class AgencyOnboardingController {
  constructor(
    private readonly onboardingFacade: AgencyOnboardingFacade,
    private readonly agencyService: AgencyService,
  ) {}

  @Post('collection')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiCreatedResponse({ type: AgencyOnboardingEnvelopeDto })
  async addToCollection(
    @Request() req: OptionalAuthenticatedRequest,
    @Body() body: CreateAgencyNodeDto,
  ) {
    return this.onboardingFacade.addToCollection(
      {
        userId: req.user?.id,
        userAgent: req.headers['user-agent'],
      },
      body,
    );
  }

  @Post('nodes')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiCreatedResponse({ type: AgencyOnboardingEnvelopeDto })
  async createNode(
    @Request() req: OptionalAuthenticatedRequest,
    @Body() body: CreateAgencyNodeDto,
  ) {
    return this.addToCollection(req, body);
  }

  @Get('import/check/:code')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PreCheckImportEnvelopeDto })
  async preCheckImport(
    @Request() req: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.agencyService.preCheckImport(req.user.id, code);
  }

  @Post('import/execute')
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: AgencyCreationEnvelopeDto })
  async executeImport(
    @Request() req: AuthenticatedRequest,
    @Body() body: ExecuteImportDto,
  ) {
    return this.agencyService.importCollection(req.user.id, body.token, {
      force_recreate_on_existing: Boolean(body.force),
      import_as_child: Boolean(body.import_as_child),
    });
  }

  @Post('import/:code')
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: AgencyCreationEnvelopeDto })
  async importByCode(
    @Request() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() body: UpdateCollectionDto,
  ) {
    return this.agencyService.importCollection(req.user.id, code, body);
  }
}
