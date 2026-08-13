import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, EntityManager } from 'typeorm';
import type {
  AgencyProductListingInfoDto,
  AgencyServiceInfoDto,
  AgencyServicesPort,
} from '../../agency';
import { Service } from '../entities/service.entity';
import { ProductListing } from '../../product-listing';

@Injectable()
export class AgencyServicesAdapter implements AgencyServicesPort {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ProductListing)
    private readonly productListingRepository: Repository<ProductListing>,
  ) {}

  async findActiveServiceById(
    serviceId: string,
    manager?: EntityManager,
  ): Promise<AgencyServiceInfoDto | null> {
    const repo = manager
      ? manager.getRepository(Service)
      : this.serviceRepository;

    const service = await repo.findOne({
      where: { id: serviceId, is_deleted: false },
      select: ['id', 'owner_id', 'title', 'base_price'],
    });
    if (!service) return null;
    return {
      id: service.id,
      owner_id: service.owner_id,
      title: service.title,
      base_price: Number(service.base_price),
    };
  }

  async findListingById(
    listingId: number,
  ): Promise<AgencyProductListingInfoDto | null> {
    const listing = await this.productListingRepository.findOne({
      where: { listing_id: listingId },
      select: ['listing_id', 'source_id'],
    });
    if (!listing) return null;
    return { listing_id: listing.listing_id, source_id: listing.source_id };
  }
}
