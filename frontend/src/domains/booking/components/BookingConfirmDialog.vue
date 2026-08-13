<template>
  <view v-if="visible" class="confirm-overlay" @click.stop>
    <view class="confirm-box">
      <view class="confirm-header">
        <text class="confirm-title">确认预约</text>
      </view>
      <view class="confirm-body">
        <text class="confirm-text">{{ content }}</text>
      </view>
      <view class="confirm-footer">
        <AppButton type="info" outline class="confirm-action-cancel" @click="emit('cancel')">取消</AppButton>
        <AppButton type="primary" class="confirm-action-ok" @click="emit('confirm')">确认</AppButton>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';

defineProps<{
  visible: boolean;
  content: string;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();
</script>

<style scoped lang="scss">
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  z-index: $uni-z-confirm;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.confirm-box {
  width: 300px;
  max-width: 85vw;
  background-color: $uni-bg-color;
  border-radius: $uni-radius-lg;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.confirm-header {
  padding: 16px;
  border-bottom: 1px solid $uni-bg-color-grey;
  text-align: center;
  background: $uni-bg-color;
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: $uni-text-color;
}

.confirm-body {
  padding: 24px 20px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $uni-bg-color;
}

.confirm-text {
  font-size: 15px;
  color: $uni-text-color-secondary;
  line-height: 1.6;
  text-align: center;
  white-space: pre-wrap;
}

.confirm-footer {
  display: flex;
  padding: 16px;
  gap: 12px;
  background-color: $uni-bg-color-hover;
  border-top: 1px solid $uni-bg-color-grey;
}

.confirm-action-cancel,
.confirm-action-ok {
  flex: 1;
}

.confirm-action-cancel {
  color: $uni-text-color-secondary;
}

.confirm-action-ok {
  background: #2563eb !important;
  border-color: #2563eb !important;
  color: $uni-bg-color !important;
}

@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
