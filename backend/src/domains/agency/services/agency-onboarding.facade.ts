import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AgencyService } from '../agency.service';
import { AgencyNode } from '../entities/agency-node.entity';
import { CreateAgencyNodeDto } from '../dto/create-agency-node.dto';
import type { LoginResponse } from '../../auth';
import type { AgencyAuthPort } from '../ports/agency-auth.port';
import { AGENCY_AUTH_PORT } from '../ports/tokens';

type AgencyOnboardingContext = {
  userId?: string;
  userAgent?: string | string[];
};

type CollectionOptions = {
  markup_amount?: number;
  markup_type?: string;
  markup_value?: number;
  alias?: string;
  private_notes?: string;
  public_notes?: string;
  compliance_content?: string;
  compliance_signature?: string;
};

type BatchImportResult = {
  id: string;
  success: boolean;
  data?: AgencyNode;
  error?: string;
};

@Injectable()
export class AgencyOnboardingFacade {
  constructor(
    private readonly agencyService: AgencyService,
    @Inject(AGENCY_AUTH_PORT)
    private readonly authPort: AgencyAuthPort,
  ) {}

  async addToCollection(
    context: AgencyOnboardingContext,
    body: CreateAgencyNodeDto,
  ) {
    const { complianceContent, complianceSignature } =
      this.validateCollectionPayload(body);
    const { userId, authPayload } = await this.resolveUserIdentity(
      context,
      body.deviceInfo,
    );

    if (body.listingIds?.length) {
      const results = await this.importListings(userId, body.listingIds);
      return authPayload ? { auth: authPayload, results } : results;
    }

    const options = this.buildCollectionOptions(
      body,
      complianceContent,
      complianceSignature,
    );

    const collection = body.listingId
      ? (
          await this.agencyService.importListing(
            userId,
            Number(body.listingId),
            options,
          )
        ).node
      : (
          await this.agencyService.createCollection(
            userId,
            body.serviceId!,
            body.parentNodeId,
            options,
          )
        ).node;

    return authPayload ? { auth: authPayload, collection } : collection;
  }

  private validateCollectionPayload(body: CreateAgencyNodeDto) {
    const complianceContent = body.compliance_content?.trim() || '';
    const complianceSignature = body.compliance_signature?.trim() || '';

    if (Boolean(complianceContent) !== Boolean(complianceSignature)) {
      throw new BadRequestException(
        'compliance_content and compliance_signature must be provided together',
      );
    }

    if (!body.listingId && !body.serviceId && !body.listingIds?.length) {
      throw new BadRequestException(
        'Either serviceId or listingId is required',
      );
    }

    return { complianceContent, complianceSignature };
  }

  private buildCollectionOptions(
    body: CreateAgencyNodeDto,
    complianceContent: string,
    complianceSignature: string,
  ): CollectionOptions {
    return {
      markup_amount: body.markup_amount,
      markup_type: body.markup_type,
      markup_value: body.markup_value,
      alias: body.alias,
      private_notes: body.private_notes,
      public_notes: body.public_notes,
      compliance_content: complianceContent || undefined,
      compliance_signature: complianceSignature || undefined,
    };
  }

  private async resolveUserIdentity(
    context: AgencyOnboardingContext,
    deviceInfo?: Record<string, unknown>,
  ): Promise<{ userId: string; authPayload: LoginResponse | null }> {
    if (context.userId) {
      return { userId: context.userId, authPayload: null };
    }

    const authPayload = await this.authPort.lightRegister({
      ...(deviceInfo || {}),
      userAgent: this.normalizeUserAgent(context.userAgent),
    });

    if (!authPayload.user.id) {
      throw new BadRequestException('Failed to resolve user identity');
    }

    return {
      userId: authPayload.user.id,
      authPayload,
    };
  }

  private async importListings(userId: string, listingIds: string[]) {
    const results: BatchImportResult[] = [];

    for (const listingId of listingIds) {
      try {
        const result = await this.agencyService.importListing(
          userId,
          Number(listingId),
        );
        results.push({
          id: listingId,
          success: true,
          data: result.node,
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        results.push({
          id: listingId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  private normalizeUserAgent(userAgent?: string | string[]) {
    return Array.isArray(userAgent) ? userAgent[0] : userAgent;
  }
}
