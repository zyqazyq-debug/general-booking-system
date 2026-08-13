<template>
  <view class="status-group">
    <view class="status-group-header" @click="emit('toggle', group.key)">
      <view class="status-group-left">
        <text class="status-group-title">{{ group.title }}</text>
        <text class="status-group-count">{{ group.items.length }}</text>
      </view>
      <text class="status-group-arrow">{{ expanded ? '▾' : '▸' }}</text>
    </view>
    <view v-show="expanded" class="status-group-body">
      <view v-if="group.items.length === 0" class="group-empty">暂无{{ group.title }}订单</view>
      <OrderListItem
        v-for="item in group.items"
        :key="item.id"
        :item="item"
        @detail="emit('detail', $event)"
        @cancel="emit('cancel', $event)"
        @provider-confirm="emit('provider-confirm', $event)"
        @complete="emit('complete', $event)"
        @hide="emit('hide', $event)"
        @provider-cancel="emit('provider-cancel', $event)"
        @provider-no-show="emit('provider-no-show', $event)"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import OrderListItem from './OrderListItem.vue';

defineProps<{
  group: { key: 'unfinished' | 'completed' | 'cancelled'; title: string; items: any[] };
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', key: 'unfinished' | 'completed' | 'cancelled'): void;
  (e: 'detail', item: any): void;
  (e: 'cancel', item: any): void;
  (e: 'provider-confirm', item: any): void;
  (e: 'complete', item: any): void;
  (e: 'hide', item: any): void;
  (e: 'provider-cancel', item: any): void;
  (e: 'provider-no-show', item: any): void;
}>();
</script>

<style scoped>
.status-group {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.status-group-header {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #f1f5f9;
}
.status-group-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-group-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}
.status-group-count {
  min-width: 18px;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 12px;
  color: #4e97fc;
  background: #eff6ff;
  border-radius: 9px;
}
.status-group-arrow {
  font-size: 14px;
  color: #64748b;
}
.status-group-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group-empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 14px 0;
}
</style>
