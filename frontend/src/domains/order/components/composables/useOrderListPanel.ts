import { onMounted, ref } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { useOrderListActions } from '../../composables/useOrderListActions';
import { useOrderListPanelFilters } from './useOrderListPanelFilters';
import { useOrderListPanelData } from './useOrderListPanelData';
import { useOrderListPanelDisplay } from './useOrderListPanelDisplay';

type OrderListScene = 'default' | 'provider-manage';

interface UseOrderListPanelOptions {
  tab: string;
  hideTabs: boolean;
  initialId: string;
  scene: OrderListScene;
}

type GroupKey = 'unfinished' | 'completed' | 'cancelled';

export function useOrderListPanel(options: UseOrderListPanelOptions) {
  const userStore = useUserStore();
  const currentTab = ref(options.tab);
  const hideTabs = ref(options.hideTabs);
  const focusedId = ref(options.initialId);
  const scene = ref<OrderListScene>(options.scene);
  const dateStart = ref('');
  const dateEnd = ref('');
  const amountMin = ref('');
  const amountMax = ref('');
  const hiddenProviderIds = ref<string[]>([]);
  const expandedGroups = ref<Record<GroupKey, boolean>>({
    unfinished: true,
    completed: false,
    cancelled: false,
  });
  const { list, isLoading, hasMore, refreshData, loadMore, initHiddenProviderIds } = useOrderListPanelData({
    currentTab,
    dateStart,
    dateEnd,
    hiddenProviderIds,
  });

  const updateFromProps = (next: Partial<UseOrderListPanelOptions>) => {
    if (typeof next.tab === 'string') {
      if (currentTab.value !== next.tab) {
        currentTab.value = next.tab;
        void refreshData();
      }
    }
    if (typeof next.hideTabs === 'boolean') {
      hideTabs.value = next.hideTabs;
    }
    if (typeof next.initialId === 'string') {
      focusedId.value = next.initialId;
    }
    if (typeof next.scene === 'string') {
      scene.value = next.scene;
    }
  };

  const switchTab = (tab: string) => {
    currentTab.value = tab;
    void refreshData();
  };

  const { getTabName, formatTimeRange, getStatusClass, formatStatus } = useOrderListPanelDisplay(currentTab);

  const { hasAnyFilter, filteredList, statusGroups, toggleGroup, onStartDateChange, onEndDateChange, resetFilters } = useOrderListPanelFilters({
    currentTab,
    focusedId,
    hiddenProviderIds,
    dateStart,
    dateEnd,
    amountMin,
    amountMax,
    list,
    expandedGroups,
    refreshData,
  });

  const {
    canCancel,
    canConsumerComplete,
    canProviderCancel,
    canProviderConfirm,
    canProviderNoShow,
    canComplete,
    canProviderComplete,
    canProviderDelete,
    cancelOrder,
    providerCancel,
    providerConfirm,
    completeOrder,
    providerNoShow,
    hideOrder,
  } =
    useOrderListActions({
      currentTab,
      scene,
      hiddenProviderIds,
      userStore,
      refreshData,
    });

  onMounted(() => {
    initHiddenProviderIds();
    void refreshData();
  });

  return {
    userStore,
    list,
    currentTab,
    scene,
    hideTabs,
    focusedId,
    dateStart,
    dateEnd,
    amountMin,
    amountMax,
    expandedGroups,
    isLoading,
    hasMore,
    filteredList,
    statusGroups,
    hasAnyFilter,
    updateFromProps,
    switchTab,
    loadMore,
    getTabName,
    toggleGroup,
    onStartDateChange,
    onEndDateChange,
    resetFilters,
    formatTimeRange,
    getStatusClass,
    formatStatus,
    canCancel,
    canConsumerComplete,
    canProviderCancel,
    canProviderConfirm,
    canProviderNoShow,
    canComplete,
    canProviderComplete,
    canProviderDelete,
    cancelOrder,
    providerCancel,
    providerConfirm,
    completeOrder,
    providerNoShow,
    hideOrder,
  };
}
