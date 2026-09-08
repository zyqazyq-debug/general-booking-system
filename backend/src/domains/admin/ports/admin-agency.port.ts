export interface AdminAgencyUserSummary {
  id: string;
  nickname: string | null;
}

export interface AdminAgencyServiceSummary {
  id: string;
  title: string;
  is_active: boolean;
}

/** Read-only administrative projection for an agency collection node. */
export interface AdminAgencyNodeDto {
  id: string;
  node_type: 'STANDARD' | 'CONTRACT';
  parent_node_id: string | null;
  service_id: string;
  agent_id: string;
  markup_amount: number;
  cache_cost_price: number;
  cache_total_price: number;
  markup_type: string;
  markup_value: number;
  alias: string | null;
  inherited_name: string | null;
  share_slug: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  agent: AdminAgencyUserSummary | null;
  service: AdminAgencyServiceSummary | null;
}

export interface AdminAgencyPort {
  findAll(): Promise<AdminAgencyNodeDto[]>;
}
