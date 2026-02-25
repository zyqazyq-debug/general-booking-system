import { request } from '@/utils/request';

export const createOrder = (data: any) => {
  return request({
    url: '/order',
    method: 'POST',
    data
  });
};
