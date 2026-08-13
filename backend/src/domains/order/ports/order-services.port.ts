export interface OrderServiceRulesSnapshot {
  start_hour?: number | string;
  end_hour?: number | string;
  weekdays?: Array<number | string>;
}

export interface OrderServiceSnapshot {
  id: string;
  owner_id: string;
  is_active?: boolean;
  title: string | null;
  description?: string | null;
  duration_minutes: number;
  base_price: number | string | null;
  provider_base_price?: number | string | null;
  cost_price?: number | string | null;
  deposit_points?: number | string | null;
  rules?: OrderServiceRulesSnapshot | null;
}

export interface OrderServiceInfoDto {
  id: string;
  owner_id: string;
  title: string | null;
  base_price: number;
}

export interface OrderServicesPort {
  findServiceById(serviceId: string): Promise<OrderServiceSnapshot | null>;
  findServiceInfoById(serviceId: string): Promise<OrderServiceInfoDto | null>;
}
