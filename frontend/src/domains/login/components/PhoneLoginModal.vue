<template>
  <AppModal
    :visible="visible"
    title="手机验证码登录"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
      <view class="modal-body-content">
        <input v-model="form.phone" class="phone-input mb-3" placeholder="请输入手机号" type="number" maxlength="11" />
        <view class="code-row mb-4">
          <input v-model="form.code" class="phone-input code-input" placeholder="验证码" type="number" maxlength="6" />
          <AppButton type="primary" size="small" outline class="send-action" :disabled="timer > 0" @click="sendCode">
            {{ timer > 0 ? `${timer}s` : '获取验证码' }}
          </AppButton>
        </view>
        <AppButton type="primary" size="large" :block="true" @click="handleSubmit">登录 / 注册</AppButton>
      </view>
  </AppModal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';

defineProps<{ visible: boolean }>();
const emit = defineEmits(['update:visible', 'submit']);

const form = reactive({ phone: '', code: '' });
const timer = ref(0);

const close = () => emit('update:visible', false);

const sendCode = () => {
    // Allow demo phone
    if (!/^1\d{10}$/.test(form.phone) && form.phone !== '13800138000') {
        return uni.showToast({ title: '请输入正确手机号', icon: 'none' });
    }
    
    let code = '1234';
    if (form.phone === '13800138000') code = '123456';

    uni.showToast({ title: `验证码: ${code}`, icon: 'none' });
    timer.value = 60;
    const interval = setInterval(() => {
        timer.value--;
        if (timer.value <= 0) clearInterval(interval);
    }, 1000);
};

const handleSubmit = () => {
    if (!form.phone || !form.code) {
        return uni.showToast({ title: '请填写手机号和验证码', icon: 'none' });
    }
    emit('submit', { ...form });
};
</script>

<style lang="scss" scoped>
.modal-body-content {
    /* No extra padding needed as AppModal handles it */
}

.phone-input {
    display: block;
    width: 100%;
    padding: 8px 12px;
    font-size: $uni-font-size-body;
    color: $uni-text-color;
    background-color: $uni-bg-color;
    border: 1px solid $uni-border-color;
    border-radius: $uni-radius-base;
    transition: border-color .15s ease-in-out;
    box-sizing: border-box; /* Important for width: 100% */
}

.phone-input:focus {
    border-color: $uni-color-primary;
    box-shadow: 0 0 0 2px rgba(78, 151, 252, 0.16);
}

.code-row {
    display: flex;
    gap: $uni-spacing-sm;
    align-items: center;
    
    .code-input { flex: 1; margin-bottom: 0; }
    .send-action {
      width: 104px;
      margin-bottom: 0;
      height: 40px; /* Match input height roughly */
      display: flex;
      align-items: center;
      justify-content: center;
    }
}

.mb-3 { margin-bottom: $uni-spacing-base; }
.mb-4 { margin-bottom: $uni-spacing-lg; }

:deep(.app-button--large) {
    margin-top: $uni-spacing-xs;
    box-shadow: 0 6px 14px -6px rgba(78, 151, 252, 0.45);
}
</style>
