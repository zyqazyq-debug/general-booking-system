import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';
import { PriceCalculator } from '../utils/price-calculator';
import { AgencyGraphService } from '../utils/agency-graph-service';

@Injectable()
export class AgencyPricingService {
  private agencyGraphService: AgencyGraphService;

  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {
    this.agencyGraphService = new AgencyGraphService(agencyRepository);
  }

  calculateMarkupAmount(
    costPrice: number,
    markupType: string,
    markupValue: number,
  ): number {
    return PriceCalculator.calculateMarkupAmount(
      costPrice,
      markupType,
      markupValue,
    );
  }

  calculateTotalPrice(costPrice: number, markupAmount: number): number {
    return PriceCalculator.calculateTotalPrice(costPrice, markupAmount);
  }

  async propagateScheduleUpdate(serviceId: string): Promise<void> {
    const rootNodes = await this.agencyRepository.find({
      where: { service_id: serviceId, parent_node_id: IsNull() },
      relations: ['service'],
    });

    for (const node of rootNodes) {
      const base = Number(node.service.base_price);
      node.cache_cost_price = base;
      node.markup_amount = this.calculateMarkupAmount(
        base,
        node.markup_type,
        node.markup_value,
      );
      node.cache_total_price = this.calculateTotalPrice(
        base,
        node.markup_amount,
      );

      const savedNode = await this.agencyRepository.save(node);
      await this.agencyGraphService.propagatePriceUpdate(
        node.id,
        savedNode.cache_total_price,
      );
    }
  }
}
