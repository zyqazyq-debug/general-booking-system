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

