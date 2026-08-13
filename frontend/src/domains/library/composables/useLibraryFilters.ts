import { ref, computed, watch, type Ref } from 'vue';
import { getCollectionAvailability } from '../api/distribution';

export interface FilterPrice {
  min: string;
  max: string;
}

export interface FilterDate {
  date: string;
}

export function useLibraryFilters(list: Ref<any[]>) {
  const keyword = ref('');
  const showFilter = ref(false);
  const filterPrice = ref<FilterPrice>({ min: '', max: '' });
  const filterDate = ref<FilterDate>({
    date: '',
  });
  const availabilityMap = ref<Record<string, string>>({});
  const availabilityCache = ref<Record<string, { fetchedAt: number; data: Record<string, string> }>>({});
  const AVAILABILITY_CACHE_TTL = 300000;

  const resetFilter = () => {
    keyword.value = '';
    filterPrice.value = { min: '', max: '' };
    filterDate.value = {
      date: '',
    };
    availabilityMap.value = {};
    availabilityCache.value = {};
  };

  const fetchAvailability = async (date: string) => {
    if (!date) {
      availabilityMap.value = {};
      return;
    }
    const cached = availabilityCache.value[date];
    if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL) {
      availabilityMap.value = cached.data;
      return;
    }
    try {
        const res: any = await getCollectionAvailability(date);
        const nextData = res || {};
      availabilityMap.value = nextData;
      availabilityCache.value[date] = {
        fetchedAt: Date.now(),
        data: nextData,
      };
    } catch (e) {
      console.error('Fetch availability failed:', e);
    }
  };

  watch(() => filterDate.value.date, (newDate) => {
    fetchAvailability(newDate);
  });

  const getProviderName = (item: any) => {
    return (
      item.service?.owner?.username ||
      item.service?.owner_name ||
      item.owner?.username ||
      item.service?.resource?.owner?.username ||
      '服务提供者'
    );
  };

  const filteredList = computed(() => {
    let result = list.value;

    // Filter by Keyword
    if (keyword.value.trim()) {
      const kw = keyword.value.toLowerCase();
      result = result.filter((item) => {
        const title = (item.alias || item.inherited_name || item.service?.title || '').toLowerCase();
        const provider = getProviderName(item).toLowerCase();
        return title.includes(kw) || provider.includes(kw);
      });
    }

    // Filter by Price
    if (filterPrice.value.min || filterPrice.value.max) {
      const min = Number.parseFloat(filterPrice.value.min) || 0;
      const max = Number.parseFloat(filterPrice.value.max) || Number.POSITIVE_INFINITY;
      result = result.filter((item) => {
        const price = Number.parseFloat(item.cache_total_price) || 0;
        return price >= min && price <= max;
      });
    }

    // Filter by Availability (Optional: Only show available if date selected?)
    // For now, we just show all but with status badges. 
    // If we wanted to filter out 'off' or 'full', we could do it here.

    return result;
  });

  return {
    keyword,
    showFilter,
    filterPrice,
    filterDate,
    availabilityMap,
    filteredList,
    resetFilter,
  };
}
