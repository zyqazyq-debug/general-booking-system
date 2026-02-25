// Lightweight API type definitions to centralize shapes used by frontend
// Generic response wrapper
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

// User
export interface User {
  id: string;
  username: string;
  roles: string[];
  wallet_balance?: number;
  credit_balance?: number;
  [key: string]: any;
}

// Auth
export interface LoginResponse {
  access_token: string;
  user: User;
}

// Agent
export interface CreateAgentLinkRequest {
  schedule_id: string;
  markup_type?: 'FIXED' | 'PERCENT';
  markup_value?: number;
}
export interface CreateAgentLinkResponse {
  token: string;
}

// Order (partial projection used by UI)
export interface Order {
  id: string;
  status: 'PENDING' | 'RESERVED' | 'COMPLETED' | 'CANCELLED' | 'FORFEITED' | 'DISPUTED';
  start_time: string;
  end_time: string;
  schedule?: { id: string; title: string };
  consumer?: { id: string; username: string };
  commission?: Record<string, any>;
  [key: string]: any;
}

// Schedule (partial)
export interface Schedule {
  id: string;
  title: string;
  base_price: number;
  duration_minutes?: number;
  is_active?: boolean;
  [key: string]: any;
}
