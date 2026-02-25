import { request } from '@/utils/request';
import type { CreateAgentLinkRequest, CreateAgentLinkResponse } from '@/types/api';

export const createAgentLink = (data: CreateAgentLinkRequest): Promise<CreateAgentLinkResponse> => {
  return request({
    url: '/agent',
    method: 'POST',
    data
  });
};

export const resolveAgentLink = (token: string): Promise<any> => {
  return request({
    url: `/agent/links/${token}`,
    method: 'GET'
  });
};
