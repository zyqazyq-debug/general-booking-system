import type { EntityManager } from 'typeorm';

export interface AgencyServiceInfoDto {
  id: string;
  owner_id: string;
  title: string | null;
  base_price: number;
}

export interface AgencyProductListingInfoDto {
  listing_id: number;
  source_id: string;
}

export interface AgencyServicesPort {
  findActiveServiceById(
    serviceId: string,
    manager?: EntityManager,
  ): Promise<AgencyServiceInfoDto | null>;

  findListingById(
    listingId: number,
  ): Promise<AgencyProductListingInfoDto | null>;
}
