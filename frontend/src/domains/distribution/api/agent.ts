import type { CreateAgentLinkRequest, CreateAgentLinkResponse } from '@/types/api';
import { createDistributionLink, importCheck } from '@/domains/library';

export const createAgentLink = (
  data: CreateAgentLinkRequest,
): Promise<CreateAgentLinkResponse> => {
  return createDistributionLink({
    serviceId: (data as any).serviceId || (data as any).service_id,
    markup_type: (data as any).markup_type,
    markup_value: (data as any).markup_value,
    private_note: (data as any).note || (data as any).private_note,
    compliance_content: (data as any).compliance_content,
    compliance_signature: (data as any).compliance_signature,
  }) as any;
};

export const resolveAgentLink = (token: string): Promise<any> => {
  return importCheck(token) as any;
};
