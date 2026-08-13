export interface AgencyLinkQueryPort {
  existsByShareSlug(slug: string): Promise<boolean>;
}
