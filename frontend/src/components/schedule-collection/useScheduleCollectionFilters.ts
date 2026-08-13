import { computed, ref, type Ref } from 'vue';

export function useScheduleCollectionFilters(list: Ref<any[]>) {
  const keyword = ref('');
  const showFilter = ref(false);
  const filterPrice = ref({ min: '', max: '' });
  const filterDate = ref({
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
  });

  const onStartDateChange = (e: any) => {
    filterDate.value.start_date = e.detail.value;
  };

  const onEndDateChange = (e: any) => {
    filterDate.value.end_date = e.detail.value;
  };

  const onStartTimeChange = (e: any) => {
    filterDate.value.start_time = e.detail.value;
  };

  const onEndTimeChange = (e: any) => {
    filterDate.value.end_time = e.detail.value;
  };

  const resetFilter = () => {
    filterPrice.value = { min: '', max: '' };
    filterDate.value = {
      start_date: '',
      start_time: '',
      end_date: '',
      end_time: '',
    };
  };

  const getProviderName = (item: any) => {
    return (
      item.service?.owner?.username ||
      item.service?.owner_name ||
      item.owner?.username ||
      item.service?.resource?.owner?.username ||
      '服务提供者'
    );
  };

  const computeFinalPrice = (item: any) => {
    if (item.cache_total_price !== undefined) {
      return Number(item.cache_total_price).toFixed(2);
    }
    const base = Number(item.service?.base_price) || 0;
    const markup = Number(item.markup_amount) || 0;
    return (base + markup).toFixed(2);
  };

  const getPriceFormula = (item: any) => {
    const base = Number(item.service?.base_price) || 0;
    const type = item.markup_type || 'FIXED';
    const value = Number(item.markup_value ?? item.markup_amount ?? 0) || 0;

    if (value === 0) return `¥${base}`;
    if (type === 'PERCENT') {
      return `¥${base} + ${value}%`;
    }
    return `¥${base} + ¥${value}`;
  };

  const filteredList = computed(() => {
    let result = list.value;

    if (keyword.value) {
      const normalizedKeyword = keyword.value.toLowerCase();
      result = result.filter((item) => {
        const aliasMatch = item.alias?.toLowerCase().includes(normalizedKeyword);
        const titleMatch = item.service?.title?.toLowerCase().includes(normalizedKeyword);
        const notesMatch = item.private_notes?.toLowerCase().includes(normalizedKeyword);
        const originalNotesMatch = item.service?.original_notes?.toLowerCase().includes(normalizedKeyword);
        const providerMatch = getProviderName(item).toLowerCase().includes(normalizedKeyword);
        return aliasMatch || titleMatch || notesMatch || originalNotesMatch || providerMatch;
      });
    }

    if (filterPrice.value.min) {
      result = result.filter((item) => Number(computeFinalPrice(item)) >= Number(filterPrice.value.min));
    }
    if (filterPrice.value.max) {
      result = result.filter((item) => Number(computeFinalPrice(item)) <= Number(filterPrice.value.max));
    }

    if (filterDate.value.start_date) {
      const startTime = filterDate.value.start_time || '00:00';
      const start = new Date(`${filterDate.value.start_date}T${startTime}:00`).getTime();
      result = result.filter((item) => new Date(item.created_at).getTime() >= start);
    }
    if (filterDate.value.end_date) {
      const endTime = filterDate.value.end_time || '23:59';
      const endInclusive = new Date(`${filterDate.value.end_date}T${endTime}:00`).getTime();
      const endExclusive = endInclusive + 60 * 1000;
      result = result.filter((item) => new Date(item.created_at).getTime() < endExclusive);
    }

    return result;
  });

  return {
    keyword,
    showFilter,
    filterPrice,
    filterDate,
    filteredList,
    onStartDateChange,
    onEndDateChange,
    onStartTimeChange,
    onEndTimeChange,
    resetFilter,
    getProviderName,
    getPriceFormula,
    computeFinalPrice,
  };
}
