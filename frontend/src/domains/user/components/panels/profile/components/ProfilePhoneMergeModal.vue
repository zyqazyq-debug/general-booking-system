<template>
  <AppModal v-model:visible="visibleModel" :title="title">
    <view class="drawer-body">
      <AppCard :bordered="false" :shadow="false" padding="16px" custom-class="profile-card">
          <text class="text-muted hint-text">
            输入手机号并验证。若该手机号已存在账号，将询问是否合并并切换到该账号。
          </text>
          <view class="form-item">
            <text class="form-label">手机号</text>
            <input
              v-model="mergeForm.phone"
              class="profile-input"
              type="number"
              placeholder="请输入手机号"
            />
          </view>
          <view class="form-item">
            <text class="form-label">验证码</text>
            <view class="code-row">
              <input
                v-model="mergeForm.code"
                class="profile-input code-input"
                type="text"
                placeholder="请输入验证码"
              />
              <AppButton
                type="primary"
                size="small"
                class="send-action"
                :disabled="sendingCode || countdown > 0"
                @click="emit('send-code')"
              >
                {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
              </AppButton>
            </view>
          </view>
          <AppButton type="primary" block class="drawer-action" :disabled="mergingAccount" @click="emit('submit')">
            {{ mergingAccount ? '处理中...' : '确认' }}
          </AppButton>
      </AppCard>
    </view>
  </AppModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppModal from '@/shared/components/AppModal.vue';
import AppButton from '@/shared/components/AppButton.vue';
import AppCard from '@/shared/components/AppCard.vue';

const props = defineProps<{
  visible: boolean;
  title: string;
  mergeForm: { phone: string; code: string };
  sendingCode: boolean;
  countdown: number;
  mergingAccount: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'send-code'): void;
  (e: 'submit'): void;
}>();

const visibleModel = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});
</script>

<style lang="scss" scoped>
.drawer-body {
  padding: 16px;
  background-color: $uni-bg-color-grey;
  min-height: 100%;
}

.hint-text {
  display: block;
  margin-bottom: 15px;
}

.form-item {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: $uni-text-color-grey;
}

.profile-input {
  width: 100%;
  height: 40px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
  font-size: 14px;
  color: $uni-text-color-secondary;
  background: $uni-bg-color;
  box-sizing: border-box;
}

.code-row {
  display: flex;
  gap: 10px;
}

.code-input {
  flex: 1;
}

.send-action {
  width: 100px;
  margin-top: 0;
}

.drawer-action {
  margin-top: 10px;
}

.text-muted {
  color: $uni-text-color-placeholder;
  font-size: 12px;
}
</style>
