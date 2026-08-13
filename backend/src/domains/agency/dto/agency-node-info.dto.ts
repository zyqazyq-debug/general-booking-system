export interface AgencyNodeInfoDto {
  id: string;
  service_id: string;
  agent_id: string;
  parent_node_id: string | null;
  status?: string;
  markup_type: string | null;
  markup_value: number | string | null;
  cache_total_price: number | string | null;
  alias?: string | null;
  inherited_name?: string | null;
}
