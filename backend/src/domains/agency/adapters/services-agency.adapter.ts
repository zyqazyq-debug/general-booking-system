import { Injectable } from '@nestjs/common';
import { AgencyService } from '../agency.service';
import type { ServicesAgencyPort } from '../../services';

@Injectable()
export class ServicesAgencyAdapter implements ServicesAgencyPort {
  constructor(private readonly agencyService: AgencyService) {}

  async propagateScheduleUpdate(serviceId: string): Promise<unknown> {
    return this.agencyService.propagateScheduleUpdate(serviceId);
  }

  async ensureOwnerRootNode(
    ownerId: string,
    serviceId: string,
  ): Promise<{ share_slug: string; id: string }> {
    const node = await this.agencyService.ensureOwnerRootNode(
      ownerId,
      serviceId,
    );
    return { share_slug: node.share_slug, id: node.id };
  }

  async findNodeById(
    nodeId: string,
  ): Promise<{ id: string; service_id: string } | null> {
    const node = await this.agencyService.findOne(nodeId);
    if (!node) return null;
    return { id: node.id, service_id: node.service_id };
  }
}
