import { ref, computed } from 'vue';
import { request } from '@/shared/api/request';
import { useBookingSourceResolver } from './useBookingSourceResolver';
import { resolveSalePrice } from '@/shared/utils/price-compat';

export function useBookingSource() {
  const service = ref<any>(null);
  const agentLinkToken = ref('');
  const agencyNodeId = ref('');
  const sourceAgentId = ref('');
  const displayPrice = ref(0);
  const isLinkBooking = ref(false);

  const showCollectionAction = computed(() => {
    return isLinkBooking.value && Boolean(service.value?.id);
  });

  const { resolveByToken, resolveBySlug } = useBookingSourceResolver({
    service,
    displayPrice,
    sourceAgentId,
    agencyNodeId,
    agentLinkToken,
  });

  const resolveNodePublicDescription = (node: any) => {
    const direct = typeof node?.public_notes === 'string' ? node.public_notes.trim() : '';
    if (direct) return direct;
    const privateNotes = typeof node?.private_notes === 'string' ? node.private_notes : '';
    if (!privateNotes) return '';
    const line = privateNotes
      .split('\n')
      .map((item: string) => item.trim())
      .find((item: string) => item.startsWith('说明：') || item.startsWith('说明:'));
    if (!line) return '';
    return line.replace(/^说明[：:]\s*/, '').trim();
  };

  const loadSource = async (options: any) => {
    // Handle string input (assume it's a service ID)
    if (typeof options === 'string') {
        options = { service_id: options };
    }

    // Reset state
    service.value = null;
    agentLinkToken.value = '';
    agencyNodeId.value = '';
    sourceAgentId.value = '';
    isLinkBooking.value = false;

    if (options.token) {
      isLinkBooking.value = true;
      await resolveByToken(options.token);
    } else if (options.slug) {
      isLinkBooking.value = true;
      await resolveBySlug(options.slug);
    } else if (options.agency_node_id) {
      const res: any = await request({
        url: `/agency/nodes/${options.agency_node_id}`,
        hideErrorToast: true,
      });
      const nodeDescription = resolveNodePublicDescription(res);
      service.value = {
        ...res.service,
        title: res.alias || res.service.title,
        description: nodeDescription || res?.service?.description || '',
      };
      displayPrice.value = resolveSalePrice(
        { sale_price: res?.service?.sale_price, cache_total_price: res?.cache_total_price, base_price: res?.service?.base_price },
        'booking_source_agency_node',
      );
      agencyNodeId.value = res.id;
    } else if (options.service_id) {
      const id = options.service_id;
      const res = await request({
        url: `/services/${id}`,
        method: 'GET',
        hideErrorToast: true,
      });
      service.value = res;
      displayPrice.value = resolveSalePrice(res as Record<string, unknown>, 'booking_source_direct_service');
    }
  };

  return {
    service,
    agentLinkToken,
    agencyNodeId,
    sourceAgentId,
    displayPrice,
    isLinkBooking,
    showCollectionAction,
    loadSource,
  };
}
