export type AgencyNodeViewDto = {
  id: string;
  status: string;
  alias: string | null;
  inherited_name: string | null;
  parent_node_id: string | null;
  service_id: string;
  share_slug?: string;
  created_at?: Date;
  updated_at?: Date;
  service: {
    id: string;
    title: string;
    duration_minutes: number;
    deposit_points?: number | string;
    buffer_minutes?: number | string;
    rules?: unknown;
    base_price: number;
    description: string;
    is_active: boolean;
  };
  agent: {
    id: string;
    nickname: string | null;
    avatar: string | null;
  };
  is_unavailable: boolean;
};

export type PublicAgencyNodeViewDto = Omit<
  AgencyNodeViewDto,
  'status' | 'created_at' | 'updated_at'
> & {
  node_status: string;
  importInfo: {
    parentNodeId: string;
    serviceId: string;
  };
};
