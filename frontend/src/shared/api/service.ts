import { request } from '@/utils/request';
import type { ApiResponse, Service, ServiceBlock, AvailabilityResponse, PaginatedResponse } from '@/types/api';

/**
 * 获取服务列表
 */
export const getServices = (params?: { 
  owner_id?: string; 
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  const url = params?.owner_id ? '/services/my' : '/services';
  return request<PaginatedResponse<Service>>({
    url,
    method: 'GET',
    params
  });
};

export const getMyServices = () => {
  return request<Service[]>({
    url: '/services/my',
    method: 'GET'
  });
};

/**
 * 获取单个服务详情
 */
export const getServiceDetail = (id: string) => {
  return request<Service>({
    url: `/services/${id}`,
    method: 'GET'
  });
};

/**
 * 创建服务
 */
export const createService = (data: Partial<Service>) => {
  return request<Service>({
    url: '/services',
    method: 'POST',
    data
  });
};

/**
 * 更新服务
 */
export const updateService = (id: string, data: Partial<Service>) => {
  return request<Service>({
    url: `/services/${id}`,
    method: 'PATCH',
    data
  });
};

/**
 * 删除服务（软删除）
 */
export const deleteService = (id: string) => {
  return request<void>({
    url: `/services/${id}`,
    method: 'DELETE'
  });
};

/**
 * 获取服务可用时间段 (新版：由后端直接返回 Slot)
 */
export const getSlotsForDate = (id: string, date: string) => {
  const query: any = {};
  if (date) query.date = date;
  return request<any[]>({
    url: `/services/${id}/available-slots`,
    method: 'GET',
    params: query
  });
};

/**
 * 获取服务可用时间段
 */
export const getServiceAvailability = (id: string, startDate: string, endDate: string, options?: any) => {
  const query: any = {};
  if (startDate) query.startDate = startDate;
  if (endDate) query.endDate = endDate;
  return request<AvailabilityResponse>({
    url: `/services/${id}/availability`,
    method: 'GET',
    params: query,
    ...options
  });
};



/**
 * 获取特定服务的休息设置
 */
export const getServiceBlocks = (serviceId: string) => {
  return request<ServiceBlock[]>({
    url: `/services/${serviceId}/blocks`,
    method: 'GET'
  });
};

/**
 * 获取全局休息设置
 */
export const getGlobalServiceBlocks = () => {
  return request<ServiceBlock[]>({
    url: '/services/blocks/global',
    method: 'GET'
  });
};

/**
 * 创建服务休息设置
 */
export const createServiceBlock = (serviceId: string, data: Partial<ServiceBlock>) => {
  return request<ServiceBlock>({
    url: `/services/${serviceId}/blocks`,
    method: 'POST',
    data
  });
};

/**
 * 创建全局休息设置
 */
export const createGlobalServiceBlock = (data: Partial<ServiceBlock>) => {
  return request<ServiceBlock>({
    url: '/services/blocks/global',
    method: 'POST',
    data
  });
};

/**
 * 更新全局休息设置
 */
export const updateGlobalServiceBlock = (blockId: string, data: Partial<ServiceBlock>) => {
  return request<ServiceBlock>({
    url: `/services/blocks/global/${blockId}`,
    method: 'PATCH',
    data
  });
};

/**
 * 删除服务休息设置
 */
export const deleteServiceBlock = (blockId: string) => {
  return request<void>({ 
    url: `/services/blocks/${blockId}`,
    method: 'DELETE'
  });
};

/**
 * 删除全局休息设置
 */
export const deleteGlobalServiceBlock = (blockId: string) => {
  return request<void>({ 
    url: `/services/blocks/global/${blockId}`,
    method: 'DELETE'
  });
};


