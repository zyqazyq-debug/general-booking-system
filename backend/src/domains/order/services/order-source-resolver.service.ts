import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import type { OrderAgencyPort } from '../ports/order-agency.port';
import { ORDER_AGENCY_PORT } from '../ports/tokens';

@Injectable()
export class OrderSourceResolverService {
  constructor(
    @Inject(ORDER_AGENCY_PORT)
    private readonly agencyPort: OrderAgencyPort,
  ) {}

  async resolve(params: {
    serviceId: string;
    basePrice: number;
    agencyNodeId?: string;
  }) {
    let displayPrice = params.basePrice;
    let agencyNodeId: string | null = null;

    if (params.agencyNodeId) {
      const node = await this.agencyPort.findById(params.agencyNodeId);
      if (!node) {
        throw new NotFoundException('Agency node not found');
      }
      if (node.service_id !== params.serviceId) {
        throw new BadRequestException('Agency node mismatch');
      }
      await this.agencyPort.validateActiveChain(node.id);

      agencyNodeId = node.id;
      displayPrice = Number(node.cache_total_price);
    }

    return { displayPrice, agencyNodeId };
  }
}
