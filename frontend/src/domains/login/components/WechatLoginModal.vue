<template>
  <AppModal
    :visible="visible"
    title="微信扫码登录"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
      <view class="modal-body text-center">
        <view class="qr-placeholder">
          <text class="qr-icon">🔳</text>
        </view>
        <text class="text-muted mt-2">请使用微信扫描二维码</text>
        <AppButton class="mt-3" type="info" size="small" :outline="true" @click="confirm">模拟扫码成功</AppButton>
      </view>
  </AppModal>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';

defineProps<{ visible: boolean }>();
const emit = defineEmits(['update:visible', 'confirm']);

const close = () => emit('update:visible', false);
const confirm = () => emit('confirm');
</script>

<style lang="scss" scoped>
.modal-body {
    &.text-center { text-align: center; }
}

.qr-placeholder {
    width: 150px;
    height: 150px;
    background: linear-gradient(180deg, $uni-color-primary-light 0%, $uni-bg-color-grey 100%);
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $uni-radius-lg;
    border: 1px solid $uni-border-color;
}

.qr-icon {
  font-size: 40px;
}

.text-muted { color: $uni-text-color-grey; font-size: $uni-font-size-sm; }
.mt-2 { margin-top: $uni-spacing-sm; }
.mt-3 { margin-top: $uni-spacing-base; }

:deep(.app-button--small) {
    height: 34px;
    min-width: 126px;
}
</style>
