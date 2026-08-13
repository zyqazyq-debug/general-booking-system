import { computed, ref, type Ref } from 'vue';
import dayjs from 'dayjs';
import { getOrders } from '../../api/order';

interface UseOrderListPanelDataOptions {
  currentTab: Ref<string>;
  dateStart: Ref<string>;
  dateEnd: Ref<string>;
  hiddenProviderIds: Ref<string[]>;
}

export function useOrderListPanelData(options: UseOrderListPanelDataOptions) {
  const list = ref<any[]>([]);
  const page = ref(1);
  const limit = ref(10);
  const total = ref(0);
  const isLoading = ref(false);

  const hasMore = computed(() => list.value.length < total.value);

  const loadData = async () => {
    if (isLoading.value) return;
    try {
      isLoading.value = true;
      const params: any = {
        role: 'consumer',
        page: page.value,
        limit: limit.value,
      };
      if (options.dateStart.value) {
        params.start_time = dayjs(options.dateStart.value).startOf('day').toISOString();
      }
      if (options.dateEnd.value) {
        params.end_time = dayjs(options.dateEnd.value).endOf('day').toISOString();
      }
      const res = await getOrders(params);
      if (page.value === 1) {
        list.value = res.data;
      } else {
        list.value = [...list.value, ...res.data];
      }
      total.value = res.meta.total;
    } catch (e) {
      console.error('[loadData]', e);
    } finally {
      isLoading.value = false;
    }
  };

  const refreshData = async () => {
    page.value = 1;
    list.value = [];
    await loadData();
  };

  const loadMore = async () => {
    if (isLoading.value || !hasMore.value) return;
    page.value += 1;
    await loadData();
  };

  const initHiddenProviderIds = () => {
    try {
      options.hiddenProviderIds.value = JSON.parse(uni.getStorageSync('hidden_orders_provider') || '[]');
    } catch {
      options.hiddenProviderIds.value = [];
    }
  };

  return {
    list,
    isLoading,
    hasMore,
    refreshData,
    loadMore,
    initHiddenProviderIds,
  };
}
