<template>
  <view class="order-list">
    <view v-if="filteredList.length === 0" class="empty-state">
      <text class="empty-icon">💰</text>
      <text class="empty-text">暂无{{ getTabName() }}</text>
    </view>
    <view v-else class="status-groups">
      <OrderListStatusGroup
        v-for="group in statusGroups"
        :key="group.key"
        :group="group"
        :expanded="expandedGroups[group.key]"
        @toggle="emit('toggle-group', $event)"
        @detail="emit('detail', $event)"
        @cancel="emit('cancel', $event)"
        @provider-confirm="emit('provider-confirm', $event)"
        @complete="emit('complete', $event)"
        @hide="emit('hide', $event)"
        @provider-cancel="emit('provider-cancel', $event)"
        @provider-no-show="emit('provider-no-show', $event)"
      />
      <view v-if="hasMore" class="load-more">
        <AppButton type="info" text class="load-more-action" :disabled="isLoading" @click="emit('load-more')">
          {{ isLoading ? '加载中...' : '点击加载更多' }}
        </AppButton>
      </view>
      <view v-else-if="list.length > 0" class="no-more">
        <text>没有更多订单了</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';
import OrderListStatusGroup from './OrderListStatusGroup.vue';
import { useOrderListUiContext } from './composables/useOrderListUiContext';

const { getTabName } = useOrderListUiContext();

defineProps<{
  list: any[];
  filteredList: any[];
  statusGroups: any[];
  expandedGroups: Record<string, boolean>;
  isLoading: boolean;
  hasMore: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-group', key: any): void;
  (e: 'detail', item: any): void;
  (e: 'cancel', item: any): void;
  (e: 'provider-confirm', item: any): void;
  (e: 'complete', item: any): void;
  (e: 'hide', item: any): void;
  (e: 'provider-cancel', item: any): void;
  (e: 'provider-no-show', item: any): void;
  (e: 'load-more'): void;
}>();
</script>

<style lang="scss" scoped>
.order-list {
  padding-bottom: 20px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 10px;
}

.empty-text {
  font-size: 14px;
  color: $uni-text-color-placeholder;
}

.status-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.load-more {
  text-align: center;
  padding: 10px 0;
}

.load-more-action {
  color: $uni-color-primary;
}

.no-more {
  text-align: center;
  padding: 20px 0;
  color: #cbd5e1;
  font-size: 13px;
}
</style>
