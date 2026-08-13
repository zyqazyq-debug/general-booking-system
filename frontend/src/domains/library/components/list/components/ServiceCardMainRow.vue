<template>
  <view class="item-main" @click="emit('toggle-expanded')">
    <view class="item-left">
      <view class="title-row">
        <text class="item-title">{{ item.alias || item.inherited_name || item.service?.title || item.service?.service_name || '未知服务' }}</text>
        <view v-if="isOffline" class="availability-badge off">
          <view class="dot"></view>
          <text class="status-label">{{ offlineLabel || '已下架' }}</text>
        </view>
        <view v-else-if="availabilityStatus" class="availability-badge" :class="availabilityStatus">
          <view class="dot"></view>
          <text class="status-label">{{ getAvailabilityLabel(availabilityStatus) }}</text>
        </view>
      </view>
      <view class="item-subtitle">
        <text class="price">¥{{ finalPrice }}</text>
        <text class="duration">{{ item.service?.duration_minutes || 60 }}分钟</text>
      </view>
    </view>
    <view class="item-right">
      <view class="item-actions" @click.stop>
        <view class="quick-actions">
          <view class="action-chip" @click.stop="emit('promote')">
            <text>分享</text>
          </view>
          <view class="action-chip" :class="{ 'action-chip--disabled': bookingDisabled }" @click.stop="onBookClick">
            <text>预约</text>
          </view>
        </view>
        <view class="action-bar">
          <view class="action-chip" @click.stop="emit('edit')">
            <text>编辑</text>
          </view>
          <view class="action-chip" :class="{ 'action-chip--down': item.status === 'ACTIVE', 'action-chip--up': item.status !== 'ACTIVE' }" @click.stop="emit('toggle')">
            <text class="action-label">{{ item.status === 'ACTIVE' ? '下架' : '上架' }}</text>
          </view>
        </view>
      </view>
      <view class="expand-toggle" @click.stop="emit('toggle-expanded')">
        <text class="expand-icon">{{ isExpanded ? '▴' : '▾' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  item: any;
  availabilityStatus?: string;
  finalPrice: string | number;
  isOffline: boolean;
  offlineLabel: string;
  isExpanded: boolean;
  getAvailabilityLabel: (status: string) => string;
}>();

const emit = defineEmits<{
  (e: 'edit'): void;
  (e: 'toggle'): void;
  (e: 'promote'): void;
  (e: 'book'): void;
  (e: 'toggle-expanded'): void;
}>();

const bookingDisabled = computed(() => props.isOffline || props.availabilityStatus === 'off');
const onBookClick = () => {
  if (bookingDisabled.value) return;
  emit('book');
};
</script>

<style lang="scss" scoped>
@use '@/styles/action-button.scss' as actionButton;

.item-main {
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.item-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.item-title {
  font-size: 15px;
  font-weight: 500;
  color: $uni-text-color;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.availability-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  flex: 0 0 auto;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: $uni-radius-circle;
  }

  &.available {
    background-color: #f0fdf4;
    color: #16a34a;
    .dot {
      background-color: #16a34a;
    }
  }
  &.limited {
    background-color: #fffbeb;
    color: #d97706;
    .dot {
      background-color: #d97706;
    }
  }
  &.full {
    background-color: #fef2f2;
    color: #dc2626;
    .dot {
      background-color: #dc2626;
    }
  }
  &.off {
    background-color: $uni-bg-color-hover;
    color: $uni-text-color-grey;
    .dot {
      background-color: $uni-text-color-grey;
    }
  }
  &.unknown {
    background-color: $uni-bg-color-grey;
    color: $uni-text-color-placeholder;
    .dot {
      background-color: $uni-text-color-placeholder;
    }
  }
}

.item-subtitle {
  display: flex;
  align-items: center;
  column-gap: 12px;
  font-size: 12px;
  min-width: 0;
}

.price {
  display: block;
  font-weight: 600;
  color: $uni-color-success;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.duration {
  color: $uni-text-color-grey;
  flex: 0 0 64px;
  width: 64px;
  text-align: right;
  white-space: nowrap;
}

.item-right {
  margin-left: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-bar {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  align-items: center;
}

.expand-toggle {
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $uni-text-color-grey;
}

.expand-icon {
  font-size: 12px;
  color: $uni-text-color-placeholder;
}

.action-chip {
  @include actionButton.action-chip-button;
}

.action-chip--disabled {
  opacity: 0.45;
}

.action-chip:active {
  @include actionButton.action-chip-button-active;
}

.action-label {
  pointer-events: none;
}

.action-chip--down {
  background-color: $uni-color-error;
  border-color: $uni-color-error;
  color: $uni-bg-color;
}

.action-chip--down:active {
  background-color: #dc2626;
}

.action-chip--up {
  background-color: #16a34a;
  border-color: #16a34a;
  color: $uni-bg-color;
}

.action-chip--up:active {
  background-color: #15803d;
}
</style>
