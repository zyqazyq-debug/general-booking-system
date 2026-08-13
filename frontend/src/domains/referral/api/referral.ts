import { request } from '@/utils/request';
import type { ApiResponse, ReferralLog } from '@/types/api';
export type { ReferralLog };

/**
 * 获取推广收益列表
 */
export const getReferralLogs = () => {
  return request<ReferralLog[]>({
    url: '/referral/logs',
    method: 'GET'
  });
};

/**
 * 获取推广统计汇总
 */
export const getReferralSummary = () => {
  return request<{
    total_amount: number;
    pending_amount: number;
    settled_amount: number;
    referral_count: number;
  }>({
    url: '/referral/summary',
    method: 'GET'
  });
};
