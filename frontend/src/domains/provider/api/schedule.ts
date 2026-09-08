// TODO(D2): migrate types to @app/shared and src/generated/api.ts after CI green
import type { components } from '@/generated/api';
import type { Pagination, BusinessErrorCode } from '@app/shared';
import { request } from '@/utils/request';

export const getSchedules = () => {
  return request({
    url: '/schedules',
    method: 'GET'
  });
};

export const getMySchedules = () => {
  return request({
    url: '/schedules/my',
    method: 'GET'
  });
};


export const createSchedule = (data: any) => {
  return request({
    url: '/schedules',
    method: 'POST',
    data
  });
};

export const updateSchedule = (id: string, data: any) => {
  return request({
    url: `/schedules/${id}`,
    method: 'PATCH',
    data
  });
};

