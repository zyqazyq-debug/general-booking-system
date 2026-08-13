<template>
  <AuthLayout :subtitle="$t('login.create_account')" :title="t('login.register_title')" :hint="t('login.register_hint')">
      <view class="mb-3">
        <text class="form-label">{{ $t('login.username') }}</text>
        <input v-model="form.username" class="auth-input" type="text" :placeholder="$t('login.username_placeholder')" />
      </view>
      <view class="mb-3">
        <text class="form-label">{{ $t('login.password') }}</text>
        <input v-model="form.password" class="auth-input" type="password" :placeholder="$t('login.password_placeholder')" />
      </view>
      <AppButton type="primary" size="large" :block="true" :loading="loading" @click="submit">
        {{ $t('login.create_account') }}
      </AppButton>
      <view class="links-row">
        <text class="login-link" @click="goToLogin">{{ $t('login.has_account') }}</text>
      </view>
  </AuthLayout>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { registerApi } from '@/domains/user';
import { useUserStore } from '@/shared/stores/user';
import AppButton from '@/shared/components/AppButton.vue';
import AuthLayout from '../components/AuthLayout.vue';
import { useI18n } from 'vue-i18n';

const userStore = useUserStore();
const { t } = useI18n();
const postLoginRedirectKey = 'postLoginRedirect';
const form = reactive({
  username: '',
  password: ''
});
const referrerId = ref('');
const referralCode = ref('');
const loading = ref(false);
const redirectAfterAuth = ref('');

const resolveSafeRedirect = () => {
  const fallback = '/pages/index/index';
  let target = redirectAfterAuth.value.trim();
  if (!target) {
    const cached = uni.getStorageSync(postLoginRedirectKey);
    target = typeof cached === 'string' ? cached.trim() : '';
  }
  if (!target) return fallback;
  if (target.startsWith('pages/')) {
    target = `/${target}`;
  }
  return target.startsWith('/pages/') ? target : fallback;
};

const submit = async () => {
  if (!form.username || !form.password) return uni.showToast({ title: t('login.toast.missing_fields'), icon: 'none' });
  
  try {
    loading.value = true;
    const payload = {
        username: form.username,
        password: form.password,
        roles: ['CONSUMER'],
        referrer_id: referrerId.value || undefined,
        referral_code: referralCode.value || undefined
    };
    const res = await registerApi(payload);
    userStore.login(res.user, res.access_token, res.refresh_token);
    
    uni.showToast({ title: t('login.toast.register_success'), icon: 'success' });
    setTimeout(() => {
        const target = resolveSafeRedirect();
        uni.removeStorageSync(postLoginRedirectKey);
        uni.reLaunch({ url: target });
    }, 1500);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => {
  const target = resolveSafeRedirect();
  const url = target
    ? `/pages/login/login?redirect=${encodeURIComponent(target)}`
    : '/pages/login/login';
  uni.navigateTo({ url });
};

onLoad((options) => {
  referrerId.value = typeof options?.referrer_id === 'string' ? options.referrer_id.trim() : '';
  referralCode.value = typeof options?.ref === 'string' ? options.ref.trim().toUpperCase() : '';
  const raw = typeof options?.redirect === 'string' ? options.redirect : '';
  if (!raw) return;
  try {
    redirectAfterAuth.value = decodeURIComponent(raw);
  } catch {
    redirectAfterAuth.value = raw;
  }
  if (redirectAfterAuth.value) {
    uni.setStorageSync(postLoginRedirectKey, redirectAfterAuth.value);
  }
});
</script>

<style lang="scss" scoped>
@use '@/styles/auth-form.scss' as authForm;

.mb-3 {
  @include authForm.auth-field-spacing;
}

.links-row {
  @include authForm.auth-links-row;
}

.login-link {
  @include authForm.auth-link;
}

.form-label {
  @include authForm.auth-form-label;
}

.auth-input {
  @include authForm.auth-form-control;
}

.auth-input:focus {
  @include authForm.auth-form-control-focus;
}

:deep(.app-button--large) {
  @include authForm.auth-primary-button-shadow;
}
</style>
