<template>
  <AuthLayout :subtitle="t('login.welcome_back')" :title="t('login.password_signin_title')" :hint="t('login.password_signin_hint')">
      <view class="login-body-content">
        <view class="mb-3">
          <text class="form-label">{{ t('login.username') }}</text>
          <input v-model="form.username" class="auth-input" :placeholder="t('login.login_id_placeholder')" />
        </view>
        <view class="mb-3">
          <text class="form-label">{{ t('login.password') }}</text>
          <input v-model="form.password" class="auth-input" password :placeholder="t('login.password_placeholder')" />
        </view>
        <AppButton type="primary" size="large" :block="true" :loading="loading" @click="submit">{{ t('app.login') }}</AppButton>
        <view class="links-row">
          <text class="register-link" @click="goToRegister">{{ t('login.no_account_register') }}</text>
        </view>
        <view class="social-login-section">
          <view class="divider">
            <view class="line"></view>
            <text class="text">{{ t('login.other_signin_methods') }}</text>
            <view class="line"></view>
          </view>
          <view class="social-icons">
            <view class="social-action wechat" role="button" tabindex="0" :aria-label="t('login.wechat_signin')" @click="openSocialLogin('wechat')" @keyup.enter="openSocialLogin('wechat')" @keyup.space="openSocialLogin('wechat')">
              <text class="icon">💬</text>
              <text class="label">{{ t('login.wechat') }}</text>
            </view>
            <view class="social-action qq" role="button" tabindex="0" :aria-label="t('login.qq_signin')" @click="openSocialLogin('qq')" @keyup.enter="openSocialLogin('qq')" @keyup.space="openSocialLogin('qq')">
              <text class="icon">🐧</text>
              <text class="label">{{ t('login.qq') }}</text>
            </view>
            <view class="social-action phone" role="button" tabindex="0" :aria-label="t('login.phone_code_signin')" @click="openSocialLogin('phone')" @keyup.enter="openSocialLogin('phone')" @keyup.space="openSocialLogin('phone')">
              <text class="icon">📱</text>
              <text class="label">{{ t('login.phone') }}</text>
            </view>
            <view class="social-action telegram" role="button" tabindex="0" :aria-label="t('login.telegram_signin')" @click="openSocialLogin('telegram')" @keyup.enter="openSocialLogin('telegram')" @keyup.space="openSocialLogin('telegram')">
              <text class="icon">✈️</text>
              <text class="label">{{ t('login.telegram') }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- Modals -->
      <WechatLoginModal v-model:visible="showWechatModal" @confirm="handleWechatLogin" />
      <QQLoginModal v-model:visible="showQQModal" @confirm="handleQQLogin" />
      <PhoneLoginModal v-model:visible="showPhoneModal" @submit="handlePhoneLogin" />
      <TelegramLoginModal v-model:visible="showTelegramModal" />
  </AuthLayout>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useUserStore } from '@/shared/stores/user';
import { loginApi, loginPhoneApi, loginTelegramApi } from '@/domains/user';
import { getDeviceInfo } from '@/utils/device';
import { useQrLogin } from '@/core/auth/qr-login/composables';
import { QrLoginStatus } from '@/core/auth/qr-login/types';
import AppButton from '@/shared/components/AppButton.vue';
import AuthLayout from '../components/AuthLayout.vue';
import WechatLoginModal from '../components/WechatLoginModal.vue';
import QQLoginModal from '../components/QQLoginModal.vue';
import PhoneLoginModal from '../components/PhoneLoginModal.vue';
import TelegramLoginModal from '../components/TelegramLoginModal.vue';
import { useI18n } from 'vue-i18n';
const userStore = useUserStore();
const { t } = useI18n();
const postLoginRedirectKey = 'postLoginRedirect';
const form = reactive({
  username: '',
  password: ''
});
const loading = ref(false);
const redirectAfterLogin = ref('');

// Modal States
const showWechatModal = ref(false);
const showQQModal = ref(false);
const showPhoneModal = ref(false);
const showTelegramModal = ref(false);

// QrLogin Setup
const { status: qrStatus, user: qrUser, start: startQr, cancel: cancelQr, manualConfirm } = useQrLogin();

const resolveSafeRedirect = () => {
  const fallback = '/pages/index/index';
  let target = redirectAfterLogin.value.trim();
  if (!target) {
    const cached = uni.getStorageSync(postLoginRedirectKey);
    target = typeof cached === 'string' ? cached.trim() : '';
  }
  if (!target) return fallback;
  target = target.replace(/^#/, '');
  if (target.startsWith('/#/')) {
    target = target.slice(2);
  }
  if (target.startsWith('//')) {
    target = `/${target.replace(/^\/+/, '')}`;
  }
  if (target.startsWith('pages/')) {
    target = `/${target}`;
  }
  if (!target.startsWith('/pages/')) return fallback;
  return target;
};

const redirectAfterSuccessLogin = () => {
  const target = resolveSafeRedirect();
  uni.removeStorageSync(postLoginRedirectKey);
  uni.reLaunch({ url: target });
};

const getAuthFlowRedirect = () => {
  const target = resolveSafeRedirect();
  return target.startsWith('/pages/') ? target : '';
};

onLoad((options?: Record<string, string>) => {
  const raw = options?.redirect || '';
  if (!raw) {
    const cached = uni.getStorageSync(postLoginRedirectKey);
    if (typeof cached === 'string' && cached.trim()) {
      redirectAfterLogin.value = cached.trim();
    }
    return;
  }
  try {
    redirectAfterLogin.value = decodeURIComponent(raw);
  } catch {
    redirectAfterLogin.value = raw;
  }
  uni.setStorageSync(postLoginRedirectKey, redirectAfterLogin.value);
  const auto = String(options?.auto || '').trim();
  if (import.meta.env.DEV && (auto === 'wechat' || auto === 'qq')) {
    if (auto === 'wechat') {
      showWechatModal.value = true;
    } else if (auto === 'qq') {
      showQQModal.value = true;
    }
    setTimeout(() => {
      void manualConfirm();
    }, 300);
  }
});

// Watch for QrLogin success
watch(qrStatus, (newStatus) => {
  console.log('[Login] QrStatus changed:', newStatus, 'User:', qrUser.value);
  if (newStatus === QrLoginStatus.CONFIRMED) {
     if (!qrUser.value) {
         console.error('[Login] Confirmed but no user data!');
         uni.showToast({ title: t('login.toast.invalid_login_data'), icon: 'none' });
         return;
     }
     
     const { user, access_token, refresh_token } = qrUser.value;
     console.log('[Login] performing login:', { uid: user?.id, hasToken: !!access_token });
     
     if (!access_token) {
         console.error('[Login] Missing access_token in response');
         uni.showToast({ title: t('login.toast.missing_login_token'), icon: 'none' });
         return;
     }

     userStore.login(user, access_token, refresh_token);
     
     if (showWechatModal.value) showWechatModal.value = false;
     if (showQQModal.value) showQQModal.value = false;
     
     uni.showToast({ title: t('login.toast.login_success'), icon: 'success' });
    console.log('[Login] 登录成功，1.5秒后跳转目标页');
     setTimeout(() => {
        console.log('[Login] 执行 reLaunch 到目标页');
        redirectAfterSuccessLogin();
     }, 1500);
  }
});

// Watch Modals to start/cancel QrLogin
watch(showWechatModal, (val) => {
    if (val) startQr('wechat');
    else if (!showQQModal.value) cancelQr();
});

watch(showQQModal, (val) => {
    if (val) startQr('qq');
    else if (!showWechatModal.value) cancelQr();
});

// Telegram Login
const handleTelegramAuth = async (user: any) => {
    try {
        const deviceInfo = getDeviceInfo();
        const res = await loginTelegramApi(user, deviceInfo);
        userStore.login(res.user, res.access_token, res.refresh_token);
        showTelegramModal.value = false;
        uni.showToast({ title: t('login.toast.login_success'), icon: 'success' });
        setTimeout(() => redirectAfterSuccessLogin(), 1500);
    } catch (e) {
        console.error(e);
        uni.showToast({ title: t('login.toast.login_failed'), icon: 'none' });
    }
};

onMounted(() => {
    (window as any).onTelegramAuth = handleTelegramAuth;
});

const submit = async () => {
  try {
    if (!form.username || !form.password) {
        return uni.showToast({ title: t('login.toast.missing_fields'), icon: 'none' });
    }
    loading.value = true;
    const deviceInfo = getDeviceInfo();
    const res = await loginApi({ ...form, deviceInfo });
    userStore.login(res.user, res.access_token, res.refresh_token);
    uni.showToast({ title: t('login.toast.login_success'), icon: 'success' });
    setTimeout(() => {
        redirectAfterSuccessLogin();
    }, 1500);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const handleWechatLogin = async () => {
    await manualConfirm();
};

const handleQQLogin = async () => {
    await manualConfirm();
};

const handlePhoneLogin = async (data: { phone: string; code: string }) => {
    try {
        const deviceInfo = getDeviceInfo();
        const result = await loginPhoneApi(data.phone, data.code, deviceInfo);
        userStore.login(result.user, result.access_token, result.refresh_token);
        showPhoneModal.value = false;
        uni.showToast({ title: t('login.toast.login_success'), icon: 'success' });
        setTimeout(() => redirectAfterSuccessLogin(), 1500);
    } catch (e) {
        console.error(e);
    }
};

const goToRegister = () => {
  const redirect = getAuthFlowRedirect();
  const url = redirect
    ? `/pages/login/register?redirect=${encodeURIComponent(redirect)}`
    : '/pages/login/register';
  uni.navigateTo({ url });
};

const openSocialLogin = (type: 'wechat' | 'qq' | 'phone' | 'telegram') => {
  if (type === 'wechat') showWechatModal.value = true;
  if (type === 'qq') showQQModal.value = true;
  if (type === 'phone') showPhoneModal.value = true;
  if (type === 'telegram') showTelegramModal.value = true;
};

</script>

<style lang="scss" scoped>
@use '@/styles/auth-form.scss' as authForm;

.mb-3 {
  @include authForm.auth-field-spacing;
}

.links-row {
  @include authForm.auth-links-row;
}

.register-link {
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

/* Social Login Section */
.social-login-section {
    margin-top: $uni-spacing-sm;
    width: 100%;
    border-top: 1px solid $uni-border-color-light;
    padding-top: $uni-spacing-sm;
}

.divider {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    .line { flex: 1; height: 1px; background-color: $uni-border-color; }
    .text { padding: 0 10px; font-size: $uni-font-size-sm; color: $uni-text-color-placeholder; }
}

.social-icons {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
}

.social-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 84px;
    border-radius: $uni-radius-base;
    padding: $uni-spacing-sm 0;
    transition: background-color 0.18s ease, transform 0.18s ease;
    
    .icon {
        width: 46px;
        height: 46px;
        border-radius: $uni-radius-circle;
        background-color: $uni-bg-color;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        box-shadow: $uni-shadow-sm;
        margin-bottom: 6px;
        border: 1px solid $uni-border-color-light;
        transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
    }
    
    .label {
        font-size: 11px;
        color: $uni-text-color-grey;
        line-height: 1.2;
        text-align: center;
        min-height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    &:active {
        background-color: $uni-bg-color-hover;
        transform: translateY(1px);
    }

    &:active .icon {
        transform: scale(0.96);
        border-color: $uni-border-color;
    }

    &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(78, 151, 252, 0.2);
        background-color: $uni-color-primary-light;
    }
}

.wechat .icon { color: #07c160; }
.qq .icon { color: #12b7f5; }
.phone .icon { color: $uni-text-color; }
.telegram .icon { color: #0088cc; }

:deep(.app-button--large) {
    @include authForm.auth-primary-button-shadow;
}
</style>
