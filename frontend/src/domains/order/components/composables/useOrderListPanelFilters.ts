import { computed, type Ref } from 'vue';

type GroupKey = 'unfinished' | 'completed' | 'cancelled';

interface UseOrderListPanelFiltersOptions {
  currentTab: Ref<string>;
  focusedId: Ref<string>;
  hiddenProviderIds: Ref<string[]>;
  dateStart: Ref<string>;
  dateEnd: Ref<string>;
  amountMin: Ref<string>;
  amountMax: Ref<string>;
  list: Ref<any[]>;
  expandedGroups: Ref<Record<GroupKey, boolean>>;
  refreshData: () => Promise<void>;
}

export function useOrderListPanelFilters(options: UseOrderListPanelFiltersOptions) {
  const hasAnyFilter = computed(() => !!options.dateStart.value || !!options.dateEnd.value || !!options.amountMin.value || !!options.amountMax.value);

  const getOrderAmount = (item: any) => {
    if (options.currentTab.value === 'CONSUMER') return Number(item.display_price_snapshot || 0);
    if (options.currentTab.value === 'AGENT') return Number(item.commission?.AGENT?.final_price ?? item.display_price_snapshot ?? 0);
    return Number(item.commission?.PROVIDER?.final_price ?? item.display_price_snapshot ?? 0);
  };

  const matchesAmountFilter = (item: any) => {
    const amount = getOrderAmount(item);
    const min = options.amountMin.value ? Number(options.amountMin.value) : null;
    const max = options.amountMax.value ? Number(options.amountMax.value) : null;
    if (min !== null && !Number.isNaN(min) && amount < min) return false;
    if (max !== null && !Number.isNaN(max) && amount > max) return false;
    return true;
  };

  const filteredList = computed(() => {
    let data = options.list.value.filter((item) => item.roles && item.roles.includes(options.currentTab.value));
    if (options.focusedId.value) {
      data = data.filter((item) => item.id === options.focusedId.value);
    }
    if (options.currentTab.value === 'PROVIDER' && options.hiddenProviderIds.value.length) {
      data = data.filter((item) => !options.hiddenProviderIds.value.includes(item.id));
    }
    return data.filter((item) => matchesAmountFilter(item));
  });

  const classifyGroup = (status: string): GroupKey => {
    if (status === 'COMPLETED') return 'completed';
    if (status === 'CANCELLED') return 'cancelled';
    return 'unfinished';
  };

  const statusGroups = computed(() => {
    const groups: Record<GroupKey, any[]> = {
      unfinished: [],
      completed: [],
      cancelled: [],
    };
    for (const item of filteredList.value) {
      groups[classifyGroup(item.status)].push(item);
    }
    return [
      { key: 'unfinished' as const, title: '未完成', items: groups.unfinished },
      { key: 'completed' as const, title: '已完成', items: groups.completed },
      { key: 'cancelled' as const, title: '取消', items: groups.cancelled },
    ];
  });

  const toggleGroup = (key: GroupKey) => {
    options.expandedGroups.value[key] = !options.expandedGroups.value[key];
  };

  const onStartDateChange = (e: any) => {
    options.dateStart.value = e?.detail?.value || '';
    void options.refreshData();
  };

  const onEndDateChange = (e: any) => {
    options.dateEnd.value = e?.detail?.value || '';
    void options.refreshData();
  };

  const resetFilters = () => {
    options.dateStart.value = '';
    options.dateEnd.value = '';
    options.amountMin.value = '';
    options.amountMax.value = '';
    void options.refreshData();
  };

  return {
    hasAnyFilter,
    filteredList,
    statusGroups,
    toggleGroup,
    onStartDateChange,
    onEndDateChange,
    resetFilters,
  };
}
