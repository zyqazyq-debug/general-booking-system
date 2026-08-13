import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';

@Injectable()
export class AgencyTreeService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {}

  async validateActiveChain(nodeId: string): Promise<void> {
    let current = await this.agencyRepository.findOne({
      where: { id: nodeId },
    });
    if (!current) throw new NotFoundException('Agency node not found');

    let depth = 0;
    while (current && depth < 50) {
      if (current.status !== 'ACTIVE') {
        throw new BadRequestException('Agency node chain is inactive');
      }
      if (!current.parent_node_id) {
        return;
      }
      const parent = await this.agencyRepository.findOne({
        where: { id: current.parent_node_id },
      });
      if (!parent) {
        throw new BadRequestException('Agency node chain is broken');
      }
      current = parent;
      depth++;
    }
    if (depth >= 50) {
      throw new BadRequestException('Agency node chain depth exceeded');
    }
  }

  async assertNoReparentCircular(
    nodeId: string,
    newParentNodeId: string,
  ): Promise<void> {
    let current = await this.agencyRepository.findOne({
      where: { id: newParentNodeId },
    });
    let depth = 0;
    while (current && current.parent_node_id && depth < 50) {
      if (current.parent_node_id === nodeId) {
        throw new BadRequestException(
          'Circular dependency detected: New parent is a descendant of this node',
        );
      }
      const parent = await this.agencyRepository.findOne({
        where: { id: current.parent_node_id },
      });
      if (!parent) break;
      current = parent;
      depth++;
    }
  }
}
