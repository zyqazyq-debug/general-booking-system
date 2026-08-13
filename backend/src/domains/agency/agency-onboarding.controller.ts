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

@Controller('agency')
export class AgencyOnboardingController {
  constructor(
    private readonly onboardingFacade: AgencyOnboardingFacade,
    private readonly agencyService: AgencyService,
  ) {}

  @Post('collection')
  @UseGuards(OptionalJwtAuthGuard)
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
  async createNode(
    @Request() req: OptionalAuthenticatedRequest,
    @Body() body: CreateAgencyNodeDto,
  ) {
    return this.addToCollection(req, body);
  }

  @Get('import/check/:code')
  @UseGuards(JwtAuthGuard)
  async preCheckImport(
    @Request() req: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.agencyService.preCheckImport(req.user.id, code);
  }

  @Post('import/execute')
  @UseGuards(JwtAuthGuard)
  async executeImport(
    @Request() req: AuthenticatedRequest,
    @Body()
    body: {
      token: string;
      force?: boolean;
      import_as_child?: boolean;
    },
  ) {
    return this.agencyService.importCollection(req.user.id, body.token, {
      force_recreate_on_existing: Boolean(body.force),
      import_as_child: Boolean(body.import_as_child),
    });
  }

  @Post('import/:code')
  @UseGuards(JwtAuthGuard)
  async importByCode(
    @Request() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body()
    body: {
      markup_amount?: number;
      markup_type?: string;
      markup_value?: number;
      alias?: string;
      private_notes?: string;
      public_notes?: string;
    },
  ) {
    return this.agencyService.importCollection(req.user.id, code, body);
  }
}
