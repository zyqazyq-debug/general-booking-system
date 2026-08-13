<template>
  <view v-if="isGlobal" class="existing-section">
    <view class="existing-title-row">
      <text class="existing-title">已有临时休息</text>
      <text class="existing-refresh" @click="emit('refresh')">刷新</text>
    </view>
    <view v-if="globalLoading" class="existing-empty">加载中...</view>
    <view v-else-if="globalBlocks.length === 0" class="existing-empty">暂无已设置的休息日程</view>
    <view v-else class="existing-list">
      <view v-for="item in globalBlocks" :key="item.id" class="existing-item">
        <view class="existing-item-main">
          <text class="existing-item-time">{{ formatRange(item.start_time, item.end_time) }}</text>
          <text class="existing-item-reason">{{ item.reason || '未填写原因' }}</text>
          <text class="existing-item-meta">覆盖 {{ item.service_count }}/{{ item.total_service_count }} 个上架服务</text>
        </view>
        <view class="existing-item-actions">
          <text class="existing-action edit" @click="emit('edit', item)">修改</text>
          <text class="existing-action delete" @click="emit('delete', item.id)">删除</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  isGlobal: boolean;
  globalLoading: boolean;
  globalBlocks: any[];
  formatRange: (start: string, end: string) => string;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'edit', item: any): void;
  (e: 'delete', id: string): void;
}>();
</script>

<style scoped lang="scss">
.existing-section {
  margin-top: 12px;
  border-top: 1px solid $uni-border-color-light;
  padding-top: 12px;
}

.existing-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.existing-title {
  font-size: $uni-font-size-body;
  font-weight: 600;
  color: $uni-text-color;
}

.existing-refresh {
  color: $uni-color-primary;
  font-size: $uni-font-size-sm;
}

.existing-empty {
  color: $uni-text-color-placeholder;
  font-size: $uni-font-size-sm;
  padding: 8px 0;
}

.existing-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}

.existing-item {
  border: 1px solid $uni-border-color-light;
  border-radius: $uni-radius-base;
  padding: 8px;
}

.existing-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.existing-item-time {
  font-size: $uni-font-size-sm;
  color: $uni-text-color;
}

.existing-item-reason {
  font-size: $uni-font-size-sm;
  color: $uni-text-color-grey;
}

.existing-item-meta {
  font-size: 12px;
  color: $uni-text-color-placeholder;
}

.existing-item-actions {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.existing-action {
  font-size: $uni-font-size-sm;
}

.existing-action.edit {
  color: $uni-color-primary;
}

.existing-action.delete {
  color: $uni-color-error;
}
</style>
