import { request } from '@/utils/request';

export interface ResolvedShareData {
  title: string;
  description?: string;
  base_price: number;
  deposit_points?: number;
  owner_name?: string;
  owner_id?: string;
  listing_id: number;
  source_service_id: string;
}

export interface ResolveShareLinkResult {
  valid: boolean;
  type: 'SINGLE' | 'COLLECTION' | 'BATCH';
  data: ResolvedShareData | ResolvedShareData[] | null;
}

export type ShareLinkInfo = ResolveShareLinkResult;

export interface CreatedShareLink {
  id: number;
  share_token: string;
  creator_id: string | null;
  target_type: 'SINGLE' | 'COLLECTION' | 'BATCH';
  target_id: string;
  expire_at: string;
  status: 'ACTIVE' | 'USED' | 'CANCELLED';
}

/**
 * 获取分享链接详情
 */
export const getShareLink = (token: string) => {
  return request<ResolveShareLinkResult>({
    url: `/share-link/resolve?token=${encodeURIComponent(token)}`,
    method: 'GET'
  });
};



/**
 * 创建分享链接
 */
export const createShareLink = (data: {
  targetType: 'SINGLE' | 'COLLECTION' | 'BATCH';
  targetId?: string;
  targetIds?: string[];
}) => {
  return request<CreatedShareLink>({
    url: '/share-link/generate',
    method: 'POST',
    data
  });
};
