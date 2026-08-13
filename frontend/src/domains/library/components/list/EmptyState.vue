<template>
  <view class="empty-state">
      <text class="empty-icon">⭐</text>
      <text class="empty-text">{{ message }}</text>
      <AppButton v-if="showButton" type="primary" outline size="small" class="mt-3" @click="$emit('action')">{{ buttonText }}</AppButton>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';

defineProps<{
  message: string,
  showButton?: boolean,
  buttonText?: string
}>();

defineEmits(['action']);
</script>

<style lang="scss" scoped>
.empty-state {
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: $uni-text-color-placeholder;
    background-color: $uni-bg-color;
    border-radius: $uni-radius-lg;
    margin-bottom: 12px;
}
.empty-icon {
    font-size: 32px;
    margin-bottom: 12px;
}
.empty-text {
    font-size: 14px;
    text-align: center;
    line-height: 1.5;
    max-width: 80%;
}
.mt-3 { margin-top: 12px; }
</style>
