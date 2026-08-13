import { request } from '@/utils/request';
import type { ApiResponse } from '@/types/api';

export interface PaymentInfo {
  payment_no: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  [key: string]: any;
}

export interface RechargeOptions {
  amount: number;
  payment_method?: string;
}

/**
 * 软件服务费充值（创建支付订单）
 */
export const rechargeSoftwareFee = (data: RechargeOptions) => {
  return request<PaymentInfo>({
    url: '/payments/recharge',
    method: 'POST',
    data
  });
};

/**
 * 查询支付状态
 */
export const getPaymentStatus = (paymentNo: string) => {
  return request<PaymentInfo>({
    url: `/payments/${paymentNo}/status`,
    method: 'GET'
  });
};
