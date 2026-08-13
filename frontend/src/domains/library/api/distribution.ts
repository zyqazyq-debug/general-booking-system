import { request } from '@/shared/api/request';

export interface DistributionLinkInfo {
  id: string;
  source_service_id: string;
  creator_id: string;
  is_active: boolean;
  slug?: string;
  source_service?: {
    title: string;
    base_price: number;
    owner_name?: string;
  };
  [key: string]: any;
}

export const resolveDistributionLink = (slug: string) => {
  return request<DistributionLinkInfo>({
    url: `/agency/s/${slug}`,
    method: 'GET'
  });
};

/**
 * 导入预检接口
 */
export const importCheck = (token: string) => {
  return request<{
    action_type: 'DEPTH_BLOCKED' | 'SAME_PARENT' | 'SELF_IN_UPSTREAM' | 'NORMAL';
    prompt_msg?: string;
    parent_id?: string;
    service_id?: string;
  }>({
    url: `/agency/import/check/${encodeURIComponent(token)}`,
    method: 'GET'
  });
};

/**
 * 执行导入接口
 */
export const executeImport = (data: { token: string; force?: boolean; import_as_child?: boolean }) => {
  return request<{
    node: { id: string };
    isNew: boolean;
  }>({
    url: `/agency/import/execute`,
    method: 'POST',
    data: {
      token: data.token,
      force: data.force,
      import_as_child: data.import_as_child
    }
  });
};

export const createDistributionLink = (data: {
  serviceId?: string;
  service_id?: string;
  listingId?: number;
  parentNodeId?: string;
  node_type?: 'STANDARD' | 'CONTRACT';
  markup_type?: 'FIXED' | 'PERCENT';
  markup_value?: number;
  alias?: string;
  private_notes?: string;
  public_notes?: string;
  private_note?: string;
  compliance_content?: string;
  compliance_signature?: string;
}) => {
  const payload: any = { ...data };
  if (!payload.serviceId && payload.service_id) {
    payload.serviceId = payload.service_id;
    delete payload.service_id;
  }
  return request<any>({
    url: '/agency/collection',
    method: 'POST',
    data: payload,
  });
};

export const createDistributionNode = createDistributionLink;

export const updateDistributionLink = (id: string, data: any) => {
  return request<any>({
    url: `/agency/collection/${id}`,
    method: 'PATCH',
    data,
  });
};

export const deleteDistributionCollection = (id: string) => {
  return request<void>({
    url: `/agency/collection/${id}`,
    method: 'DELETE',
  });
};

export const getMyCollections = () => {
  return request<any[]>({
    url: '/agency/collection',
    method: 'GET',
    hideLoading: true,
    hideErrorToast: true,
  });
};

export const reparentDistributionLink = (id: string, newParentNodeId: string) => {
  return request<void>({
    url: `/agency/collection/${id}/reparent`,
    method: 'PATCH',
    data: { newParentNodeId },
  });
};
export const updateDistributionLinkStatus = (id: string, is_active: boolean) => {
  return request<void>({
    url: `/agency/collection/${id}/status`,
    method: 'PATCH',
    data: { is_active },
  });
};
export const getCollectionAvailability = (date: string) => {
  return request<any>({
    url: '/agency/collection/availability',
    method: 'GET',
    data: { date }
  });
};
