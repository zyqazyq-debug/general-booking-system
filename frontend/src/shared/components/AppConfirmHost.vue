<template>
  <view v-if="appConfirmState.visible" class="app-confirm-mask" @click.stop>
    <view class="app-confirm-box" @click.stop>
      <view class="app-confirm-header">
        <text class="app-confirm-title">{{ appConfirmState.title }}</text>
      </view>
      <view class="app-confirm-body">
        <text class="app-confirm-content">{{ appConfirmState.content }}</text>
        <textarea
          v-if="appConfirmState.editable"
          v-model="appConfirmState.inputValue"
          class="app-confirm-textarea"
          :placeholder="appConfirmState.placeholderText"
          maxlength="200"
        />
      </view>
      <view class="app-confirm-footer">
        <AppButton
          v-if="appConfirmState.showCancel"
          type="info"
          outline
          class="app-confirm-action app-confirm-action-cancel"
          @click="confirmCancel"
        >
          {{ appConfirmState.cancelText }}
        </AppButton>
        <AppButton
          type="primary"
          class="app-confirm-action app-confirm-action-ok"
          :style="{ backgroundColor: appConfirmState.confirmColor, borderColor: appConfirmState.confirmColor }"
          @click="confirmOk"
        >
          {{ appConfirmState.confirmText }}
        </AppButton>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import AppButton from '@/components/AppButton.vue';
import { appConfirmState, confirmCancel, confirmOk } from '@/utils/app-confirm';

watch(() => appConfirmState.visible, (newVal) => {
  console.log('[AppConfirmHost] visible changed:', newVal);
});
</script>

<style lang="scss" scoped>
.app-confirm-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: $uni-bg-color-mask;
  z-index: $uni-z-confirm;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.app-confirm-box {
  width: 320px;
  max-width: 88vw;
  background-color: $uni-bg-color;
  border-radius: $uni-radius-lg;
  overflow: hidden;
  box-shadow: $uni-shadow-lg;
}

.app-confirm-header {
  padding: 14px 16px;
  border-bottom: 1px solid $uni-border-color-light;
  text-align: center;
}

.app-confirm-title {
  font-size: 17px;
  font-weight: 600;
  color: $uni-text-color;
}

.app-confirm-body {
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.app-confirm-content {
  font-size: 14px;
  line-height: 1.6;
  color: $uni-text-color-secondary;
  white-space: pre-wrap;
  text-align: center;
}

.app-confirm-textarea {
  width: 100%;
  min-height: 90px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.5;
  color: $uni-text-color-secondary;
  box-sizing: border-box;
}

.app-confirm-footer {
  display: flex;
  gap: 12px;
  padding: 12px 16px 16px;
  background-color: $uni-bg-color-hover;
}

.app-confirm-action {
  flex: 1;
  height: 42px;
  line-height: 42px;
  border-radius: $uni-radius-base;
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}

.app-confirm-action-cancel {
  background-color: $uni-bg-color;
  color: $uni-text-color-grey;
  border: 1px solid $uni-border-color;
}

.app-confirm-action-ok {
  color: $uni-text-color-inverse;
  border: 1px solid transparent;
}
</style>
