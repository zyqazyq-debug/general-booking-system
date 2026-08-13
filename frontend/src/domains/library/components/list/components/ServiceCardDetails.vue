<template>
  <view v-if="isExpanded" class="item-details">
    <view v-if="timeRule" class="detail-row">
      <text class="value">{{ timeRule }}</text>
    </view>
    <view v-if="item.service?.description" class="detail-row">
      <text class="value detail-description">{{ item.service?.description }}</text>
    </view>
    <view v-if="item.service?.original_notes || item.private_notes" class="detail-row">
      <text class="value">{{ item.private_notes || item.service?.original_notes }}</text>
    </view>
    <view v-if="isOffline" class="detail-row">
      <text class="status-badge offline">{{ statusText }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  item: any;
  isExpanded: boolean;
  isOffline: boolean;
  statusText: string;
  timeRule: string;
}>();
</script>

<style scoped lang="scss">
.item-details {
  padding: 0 12px 12px 12px;
  background-color: #fafafa;
  border-top: 1px dashed $uni-border-color-light;
}

.detail-row {
  display: flex;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;

  .value {
    color: $uni-text-color-secondary;
    flex: 1;
  }
}

.detail-description {
  color: #64748b;
}

.status-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;

  &.offline {
    background-color: #fef2f2;
    color: #ef4444;
  }
}
</style>
