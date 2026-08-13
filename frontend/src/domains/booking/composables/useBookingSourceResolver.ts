import { type Ref } from 'vue';
import { request } from '@/shared/api/request';
import { resolveSalePrice } from '@/shared/utils/price-compat';

interface UseBookingSourceResolverOptions {
  service: Ref<any>;
  displayPrice: Ref<number>;
  sourceAgentId: Ref<string>;
  agencyNodeId: Ref<string>;
  agentLinkToken: Ref<string>;
}

export function useBookingSourceResolver(options: UseBookingSourceResolverOptions) {
  const applySlugResult = (res: any) => {
    options.service.value = res.service;
    options.displayPrice.value = resolveSalePrice(
      res.service as Record<string, unknown>,
      'booking_resolver_slug',
    );
    options.agencyNodeId.value = res?.importInfo?.parentNodeId || '';
    options.sourceAgentId.value = res?.agent?.id || '';
    options.agentLinkToken.value = '';
  };

  const resolveByToken = async (token: string) => {
    const res: any = await request({ url: `/agency/s/${token}` });
    applySlugResult(res);
  };

  const resolveBySlug = async (slug: string) => {
    const res: any = await request({ url: `/agency/s/${slug}` });
    applySlugResult(res);
  };

  return {
    resolveByToken,
    resolveBySlug,
  };
}
