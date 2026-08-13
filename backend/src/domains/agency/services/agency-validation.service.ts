import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';

type ServiceRecord = {
  id: string;
  base_price: number | string;
};

@Injectable()
export class AgencyValidationService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
    private readonly dataSource: DataSource,
  ) {}

  async resolveCreateCollectionContext(
    agentId: string,
    serviceId: string,
    parentNodeId?: string,
  ): Promise<{
    parentNodeId?: string;
    costPrice: number;
    inheritedName: string | null;
  }> {
    const resolvedParentNodeId = parentNodeId;
    let costPrice = 0;
    let inheritedName: string | null = null;

    if (resolvedParentNodeId) {
      const parent = await this.agencyRepository.findOne({
        where: { id: resolvedParentNodeId },
      });
      if (!parent) {
        throw new NotFoundException('Parent agency node not found');
      }
      if (parent.service_id !== serviceId) {
        throw new NotFoundException('Service mismatch with parent node');
      }

      costPrice = Number(parent.cache_total_price);
      inheritedName = parent.alias || parent.inherited_name || null;
    } else {
      const serviceRepository =
        this.dataSource.getRepository<ServiceRecord>('Service');
      const service = await serviceRepository.findOne({
        where: { id: serviceId },
      });
      if (!service) {
        throw new NotFoundException('Service not found');
      }
      costPrice = Number(service.base_price);
    }

    return {
      parentNodeId: resolvedParentNodeId,
      costPrice,
      inheritedName,
    };
  }
}
