<template>
  <view v-if="!hideTabs" class="tabs-container">
    <view
      v-for="item in ORDER_ROLE_OPTIONS"
      :key="item.role"
      class="order-tab-item"
      :class="{ active: currentTab === item.role }"
      @click="emit('switch-tab', item.role)"
    >
      <text>{{ item.label }}</text>
      <view v-if="currentTab === item.role" class="order-tab-line"></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ORDER_ROLE_OPTIONS } from '../composables/useOrderScene';

defineProps<{
  hideTabs: boolean;
  currentTab: string;
}>();

const emit = defineEmits<{
  (e: 'switch-tab', tab: string): void;
}>();
</script>

<style scoped>
.tabs-container {
  display: flex;
  background-color: #fff;
  padding: 0 16px;
  margin-bottom: 12px;
  border-radius: 0 0 12px 12px;
}

.order-tab-item {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 14px;
  color: #64748b;
  position: relative;
}

.order-tab-item.active {
  color: #4e97fc;
  font-weight: 600;
}

.order-tab-line {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  background-color: #4e97fc;
  border-radius: 2px;
}
</style>
