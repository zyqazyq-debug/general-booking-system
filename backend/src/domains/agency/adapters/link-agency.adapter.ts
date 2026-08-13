import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';
import type { AgencyLinkQueryPort } from '../ports/agency-link-query.port';

@Injectable()
export class LinkAgencyAdapter implements AgencyLinkQueryPort {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {}

  async existsByShareSlug(slug: string): Promise<boolean> {
    const found = await this.agencyRepository.findOne({
      where: { share_slug: slug },
      select: ['id'],
    });
    return Boolean(found);
  }
}
