export interface AdminOrderServiceSummary {
  id: string;
  title: string;
}

export interface AdminOrderUserSummary {
  id: string;
  username: string;
  nickname: string | null;
}

export interface AdminOrderAgencyNodeSummary {
  id: string;
  share_slug: string;
  agent: AdminOrderUserSummary | null;
}

/** Read-only administrative projection. It deliberately excludes credentials and PII. */
export interface AdminOrderDto {
  id: string;
  order_no: string;
  consumer_id: string;
  owner_id: string;
  service_id: string | null;
  agency_node_id: string | null;
  start_time: Date;
  end_time: Date;
  status: string;
  frozen_points: number;
  display_price_snapshot: number;
  created_at: Date;
  updated_at: Date;
  service: AdminOrderServiceSummary | null;
  consumer: AdminOrderUserSummary | null;
  agency_node: AdminOrderAgencyNodeSummary | null;
}

export interface AdminOrderPort {
  findAllForAdmin(): Promise<AdminOrderDto[]>;
}
