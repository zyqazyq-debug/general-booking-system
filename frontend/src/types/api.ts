// Lightweight API type definitions to centralize shapes used by frontend
// Generic response wrapper
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

// Pagination metadata
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Paginated response wrapper
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// User
export interface User {
  id: string;
  username: string;
  referral_code?: string;
  roles: string[];
  wallet_balance?: number;
  credit_balance?: number;
  frozen_credit?: number;
  avatar?: string;
  nickname?: string;
  [key: string]: unknown;
}

// Auth
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

// Agent
export interface CreateAgentLinkRequest {
  service_id: string; // Renamed from schedule_id
  markup_type: 'FIXED' | 'PERCENT';
  markup_value: number;
  agent_id?: string;
  compliance_content?: string;
  compliance_signature?: string;
}
export interface CreateAgentLinkResponse {
  token: string;
  id: string;
}

// Order
export enum OrderStatus {
  PENDING = 'PENDING',
  RESERVED = 'RESERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FORFEITED = 'FORFEITED',
  DISPUTED = 'DISPUTED',
}

export interface Order {
  id: string;
  order_no: string;
  status: OrderStatus;
  start_time: string;
  end_time: string;
  frozen_points: number;
  display_price_snapshot: number;
  service_id: string | null;
  service?: Service | null;
  service_snapshot?: {
    title: string;
    description?: string;
    duration_minutes: number;
    base_price: number;
    provider_base_price?: number;
    cost_price?: number;
    sale_price?: number;
    owner_name?: string;
  };
  consumer_id: string;
  consumer?: User;
  owner_id: string;
  owner?: User;
  commission?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// Service
export interface Service {
  id: string;
  title: string;
  base_price: number;
  provider_base_price?: number;
  cost_price?: number;
  sale_price?: number;
  deposit_points: number;
  duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  is_deleted?: boolean;
  owner_id: string;
  description?: string;
  rules?: {
    weekdays: number[];
    start_hour: number;
    end_hour: number;
    [key: string]: any;
  };
  location?: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  images?: string[];
  metadata?: Record<string, any>;
  [key: string]: unknown;
}

// Service Block
export enum ServiceBlockType {
  TIME_OFF = 'TIME_OFF',
  HOLIDAY = 'HOLIDAY',
  MAINTENANCE = 'MAINTENANCE',
}

export interface ServiceBlock {
  id: string;
  service_id?: string;
  type: ServiceBlockType;
  start_time: string;
  end_time: string;
  reason?: string;
  description?: string;
  notes?: string;
  created_at: string;
}

// Availability
export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface AvailabilityResponse {
  date: string;
  slots: TimeSlot[];
}

// Referral
export interface ReferralLog {
  id: string;
  sourceUserId: string;
  sourceUser?: User;
  beneficiaryId: string;
  beneficiary?: User;
  amount: number;
  base_amount: number;
  level: number;
  type: string;
  created_at: string;
}

export interface UserProfile extends User {
  locale?: string;
  email?: string;
  phone?: string;
  telegram_chat_id?: string;
  wechat_openid?: string;
  qq_openid?: string;
}

export interface AgencyCollectionNode {
  id: string;
  service_id: string;
  parent_node_id?: string | null;
  status: 'ACTIVE' | 'DELETED' | 'INACTIVE';
  share_slug?: string;
  alias?: string;
  inherited_name?: string;
  cache_cost_price?: number;
  cache_total_price?: number;
  markup_type?: 'FIXED' | 'PERCENT';
  markup_value?: number;
  markup_amount?: number;
  service?: Service;
  [key: string]: unknown;
}
