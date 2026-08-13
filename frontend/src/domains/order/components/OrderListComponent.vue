<template>
  <view class="order-list-comp">
    <OrderTabsBar :hide-tabs="hideTabs" :current-tab="currentTab" @switch-tab="switchTab" />

    <OrderFilterPanel
      :date-start="dateStart"
      :date-end="dateEnd"
      :amount-min="amountMin"
      :amount-max="amountMax"
      :has-any-filter="hasAnyFilter"
      @start-date-change="onStartDateChange"
      @end-date-change="onEndDateChange"
      @update:amount-min="amountMin = $event"
      @update:amount-max="amountMax = $event"
      @reset="resetFilters"
    />

    <OrderListContent
      :list="list"
      :filtered-list="filteredList"
      :status-groups="statusGroups"
      :expanded-groups="expandedGroups"
      :is-loading="isLoading"
      :has-more="hasMore"
      @toggle-group="toggleGroup"
      @detail="onOrderClick"
      @cancel="cancelOrder"
      @provider-confirm="providerConfirm"
      @complete="completeOrder"
      @hide="hideOrder"
      @provider-cancel="providerCancel"
      @provider-no-show="providerNoShow"
      @load-more="loadMore"
    />
  </view>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import OrderTabsBar from './OrderTabsBar.vue';
import OrderFilterPanel from './OrderFilterPanel.vue';
import OrderListContent from './OrderListContent.vue';
import { useOrderListPanel } from './composables/useOrderListPanel';
import { provideOrderListUiContext } from './composables/useOrderListUiContext';

interface Props {
  tab?: string;
  hideTabs?: boolean;
  initialId?: string;
  scene?: 'default' | 'provider-manage';
}

const props = withDefaults(defineProps<Props>(), {
  tab: 'CONSUMER',
  hideTabs: false,
  initialId: '',
  scene: 'default',
});

const emit = defineEmits<{
  (e: 'order-click', payload: { id: string; role: string }): void;
}>();

const {
  list,
  currentTab,
  scene,
  hideTabs,
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
} = useOrderListPanel({
  tab: props.tab,
  hideTabs: props.hideTabs,
  initialId: props.initialId,
  scene: props.scene,
});

watch(
  () => props.tab,
  (tab) => {
    updateFromProps({ tab });
  },
);

watch(
  () => props.hideTabs,
  (value) => {
    updateFromProps({ hideTabs: value });
  },
);

watch(
  () => props.initialId,
  (value) => {
    updateFromProps({ initialId: value });
  },
);

watch(
  () => props.scene,
  (value) => {
    updateFromProps({ scene: value });
  },
);

const onOrderClick = (item: any) => {
  emit('order-click', { id: item.id, role: currentTab.value });
};

provideOrderListUiContext({
  currentTab,
  scene,
  getTabName,
  formatStatus,
  getStatusClass,
  formatTimeRange,
  canCancel,
  canConsumerComplete,
  canProviderCancel,
  canProviderConfirm,
  canProviderNoShow,
  canComplete,
  canProviderComplete,
  canProviderDelete,
});
</script>

<style scoped>
</style>
