export interface ServicesAgencyPort {
  propagateScheduleUpdate(serviceId: string): Promise<unknown>;
  ensureOwnerRootNode(
    ownerId: string,
    serviceId: string,
  ): Promise<{ share_slug: string; id: string }>;
  findNodeById(
    nodeId: string,
  ): Promise<{ id: string; service_id: string } | null>;
}
