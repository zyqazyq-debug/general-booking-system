import type { EntityManager } from 'typeorm';
import type { User as TelegramUser } from 'telegraf/types';

export const PLATFORM_USERS_PORT = 'PLATFORM_USERS_PORT';
export const PLATFORM_AGENCY_PORT = 'PLATFORM_AGENCY_PORT';
export const PLATFORM_SERVICES_PORT = 'PLATFORM_SERVICES_PORT';
export const PLATFORM_ORDER_PORT = 'PLATFORM_ORDER_PORT';
export const PLATFORM_SYSTEM_CONFIG_PORT = 'PLATFORM_SYSTEM_CONFIG_PORT';
export const PLATFORM_AUTH_PORT = 'PLATFORM_AUTH_PORT';

export interface PlatformUserDto {
  id: string;
  username: string;
  phone?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  roles: string[];
  referral_code?: string;
  referrer_id?: string | null;
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
}

export interface PlatformAgencyNodeDto {
  id: string;
  service_id: string;
  agent_id: string;
  share_slug?: string;
  status?: string;
  alias?: string | null;
  inherited_name?: string | null;
  cache_total_price?: number | string | null;
  cache_cost_price?: number | string | null;
  markup_amount?: number | string | null;
  markup_type?: string | null;
  markup_value?: number | string | null;
  service?: {
    title?: string | null;
    duration_minutes?: number | null;
    is_active?: boolean;
    is_deleted?: boolean;
  } | null;
}

export interface PlatformOrderDto {
  id?: string;
  order_no: string;
  display_price_snapshot: number;
  service_id?: string | null;
  consumer_id?: string;
  owner_id?: string | null;
  agency_node_id?: string | null;
  start_time?: Date | string;
  end_time?: Date | string;
  status?: string;
}

export interface PlatformUsersPort {
  findByTelegram(chatId: string): Promise<PlatformUserDto | null>;
  findByReferralCode(code: string): Promise<PlatformUserDto | null>;
  findOne(id: string): Promise<PlatformUserDto | null>;
  save(user: PlatformUserDto): Promise<PlatformUserDto>;
  syncTelegramUser(
    userOrChatId: string | PlatformUserDto,
    telegramUser: TelegramUser,
  ): Promise<PlatformUserDto | null>;
  createWithProvider(params: {
    username: string;
    telegram_chat_id?: string;
    telegram_username?: string;
    nickname?: string;
    avatar?: string;
    roles?: string[];
    is_verified?: boolean;
  }): Promise<PlatformUserDto>;
}

export interface PlatformAgencyPort {
  preCheckImport(
    agentId: string,
    code: string,
  ): Promise<{
    action_type:
      | 'DEPTH_BLOCKED'
      | 'SAME_PARENT'
      | 'SELF_IN_UPSTREAM'
      | 'NORMAL';
    prompt_msg?: string;
    parent_id?: string;
    service_id?: string;
  }>;
  importCollection(
    agentId: string,
    code: string,
    options?: {
      markup_type?: string;
      markup_value?: number;
      alias?: string;
      private_notes?: string;
      public_notes?: string;
      force_recreate_on_existing?: boolean;
      import_as_child?: boolean;
    },
  ): Promise<{ node: PlatformAgencyNodeDto; isNew: boolean }>;
  findById(id: string): Promise<PlatformAgencyNodeDto | null>;
  findOne(id: string): Promise<PlatformAgencyNodeDto | null>;
  findBySlug(slug: string): Promise<{ id: string } | null>;
  updateCollection(
    agentId: string,
    nodeId: string,
    data: {
      markup_amount?: number;
      private_notes?: string;
      public_notes?: string;
      markup_type?: string;
      markup_value?: number;
      alias?: string;
    },
  ): Promise<PlatformAgencyNodeDto | null>;
}

export interface PlatformServicesPort {
  getAvailableSlots(serviceId: string, dateStr: string): Promise<unknown>;
}

export interface PlatformOrderPort {
  create(params: {
    consumer_id: string;
    service_id: string;
    start_time: string;
    end_time: string;
    agency_node_id?: string;
    source_idempotency_key?: string;
  }): Promise<PlatformOrderDto>;
}

export interface PlatformSystemConfigPort {
  get<T>(key: string, defaultValue?: T): Promise<T>;
}

export interface PlatformAuthPort {
  login(
    user: PlatformUserDto,
    deviceInfo?: Record<string, unknown>,
  ): Promise<unknown>;
  loginByChatId(chatId: string, telegramUser?: unknown): Promise<unknown>;
  performAccountMerge(
    manager: EntityManager,
    sourceUser: PlatformUserDto,
    targetUser: PlatformUserDto,
  ): Promise<PlatformUserDto>;
}
