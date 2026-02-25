<template>
  <view class="login-page">
    <view class="login-header">
      <text class="logo">通用预约</text>
      <text class="subtitle">欢迎登录</text>
    </view>

    <view class="login-body">
      <view class="mb-3">
        <text class="form-label">用户名</text>
        <input class="form-control" v-model="form.username" placeholder="手机号 / 用户名" />
      </view>
      <view class="mb-3">
        <text class="form-label">密码</text>
        <input class="form-control" password v-model="form.password" placeholder="请输入密码" />
      </view>
      <button class="btn btn-primary" @click="submit">登录</button>
      <view class="links-row">
        <text class="text-primary" @click="goToRegister">没有账号？注册</text>
      </view>
      <view class="social-login-section">
        <view class="divider">
          <view class="line"></view>
          <text class="text">其他方式登录</text>
          <view class="line"></view>
        </view>
        <view class="social-icons">
          <view class="social-btn wechat" @click="showWechatModal = true">
            <text class="icon">💬</text>
            <text class="label">微信</text>
          </view>
          <view class="social-btn qq" @click="showQQModal = true">
            <text class="icon">🐧</text>
            <text class="label">QQ</text>
          </view>
          <view class="social-btn phone" @click="showPhoneModal = true">
            <text class="icon">📱</text>
            <text class="label">手机</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Modals -->
    <!-- WeChat Modal -->
    <view class="modal-mask" v-if="showWechatModal" @click="showWechatModal = false">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text>微信扫码登录</text>
          <text class="close-btn" @click="showWechatModal = false">×</text>
        </view>
        <view class="modal-body text-center">
          <view class="qr-placeholder">
            <text style="font-size: 40px;">🔳</text>
          </view>
          <text class="text-muted mt-2">请使用微信扫描二维码</text>
          <button class="btn btn-sm btn-outline-primary mt-3" @click="handleWechatLogin">模拟扫码成功</button>
        </view>
      </view>
    </view>

    <!-- QQ Modal -->
    <view class="modal-mask" v-if="showQQModal" @click="showQQModal = false">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text>QQ扫码登录</text>
          <text class="close-btn" @click="showQQModal = false">×</text>
        </view>
        <view class="modal-body text-center">
          <view class="qr-placeholder">
            <text style="font-size: 40px;">🐧</text>
          </view>
          <text class="text-muted mt-2">请使用手机QQ扫描二维码</text>
          <button class="btn btn-sm btn-outline-primary mt-3" @click="handleQQLogin">模拟扫码成功</button>
        </view>
      </view>
    </view>

    <!-- Phone Modal -->
    <view class="modal-mask" v-if="showPhoneModal" @click="showPhoneModal = false">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text>手机验证码登录</text>
          <text class="close-btn" @click="showPhoneModal = false">×</text>
        </view>
        <view class="modal-body">
          <input class="form-control mb-3" v-model="phoneForm.phone" placeholder="请输入手机号" type="number" maxlength="11" />
          <view class="code-row mb-4">
            <input class="form-control code-input" v-model="phoneForm.code" placeholder="验证码" type="number" maxlength="6" />
            <button class="btn btn-sm btn-outline-primary send-btn" :disabled="timer > 0" @click="sendCode">
              {{ timer > 0 ? `${timer}s` : '获取验证码' }}
            </button>
          </view>
          <button class="btn btn-primary" @click="handlePhoneLogin">登录 / 注册</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useUserStore } from '@/stores/user';
import { loginApi, loginWechatApi, loginQQApi, loginPhoneApi } from '@/api/user';

const userStore = useUserStore();
const form = reactive({
  username: '',
  password: ''
});

// Modal States
const showWechatModal = ref(false);
const showQQModal = ref(false);
const showPhoneModal = ref(false);

// Phone Login State
const phoneForm = reactive({ phone: '', code: '' });
const timer = ref(0);

const submit = async () => {
  try {
    if (!form.username || !form.password) {
        return uni.showToast({ title: '请填写所有字段', icon: 'none' });
    }
    const res = await loginApi(form);
    userStore.login(res.user, res.access_token);
    uni.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
        uni.reLaunch({ url: '/pages/index/index' });
    }, 1500);
  } catch (e) {
    console.error(e);
  }
};

const handleWechatLogin = async () => {
    // const mockOpenid = 'wx_' + Math.random().toString(36).substring(7);
    const mockOpenid = 'demo'; // Use fixed demo user
    try {
        const res = await loginWechatApi(mockOpenid);
        userStore.login(res.user, res.access_token);
        showWechatModal.value = false;
        uni.showToast({ title: '微信登录成功', icon: 'success' });
        setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500);
    } catch (e) {
        console.error(e);
    }
};

const handleQQLogin = async () => {
    // const mockOpenid = 'qq_' + Math.random().toString(36).substring(7);
    const mockOpenid = 'demo'; // Use fixed demo user
    try {
        const res = await loginQQApi(mockOpenid);
        userStore.login(res.user, res.access_token);
        showQQModal.value = false;
        uni.showToast({ title: 'QQ登录成功', icon: 'success' });
        setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500);
    } catch (e) {
        console.error(e);
    }
};

const sendCode = () => {
    // Allow demo phone
    if (!/^1\d{10}$/.test(phoneForm.phone) && phoneForm.phone !== '13800138000') {
        return uni.showToast({ title: '请输入正确手机号', icon: 'none' });
    }
    
    let code = '1234';
    if (phoneForm.phone === '13800138000') code = '123456';

    uni.showToast({ title: `验证码: ${code}`, icon: 'none' });
    timer.value = 60;
    const interval = setInterval(() => {
        timer.value--;
        if (timer.value <= 0) clearInterval(interval);
    }, 1000);
};

const handlePhoneLogin = async () => {
    if (!phoneForm.phone || !phoneForm.code) {
        return uni.showToast({ title: '请填写手机号和验证码', icon: 'none' });
    }
    try {
        const result = await loginPhoneApi(phoneForm.phone, phoneForm.code);
        userStore.login(result.user, result.access_token);
        showPhoneModal.value = false;
        uni.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500);
    } catch (e) {
        console.error(e);
    }
};

const goToRegister = () => {
  uni.navigateTo({ url: '/pages/login/register' });
};

</script>

<style lang="scss">
.login-page {
    height: calc(var(--app-vh, 1vh) * 100);
    display: flex;
    flex-direction: column;
    padding: 24px 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
    overflow: hidden;
}
.login-header {
    text-align: center;
    margin-top: 8px;
    margin-bottom: 16px;
}
.logo { font-size: 22px; font-weight: 700; color: #1e293b; }
.subtitle { font-size: 12px; color: #64748b; margin-top: 6px; display: block; }

.login-body {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    flex: 1 1 auto;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    min-height: 0;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.login-body::-webkit-scrollbar { width: 0; height: 0; }
.links-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    font-size: 12px;
}
.admin-link { color: #94a3b8; }

.quick-login { display: none; }
.tags { display: none; }
.tag { display: none; }

.social-login-section {
    margin-top: 8px;
    width: 100%;
}

.divider {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    .line { flex: 1; height: 1px; background-color: #e2e8f0; }
    .text { padding: 0 10px; font-size: 12px; color: #94a3b8; }
}

.social-icons {
    display: flex;
    justify-content: center;
    gap: 16px;
}

.social-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 60px;
    
    .icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background-color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.05);
        margin-bottom: 6px;
        border: 1px solid #f1f5f9;
    }
    
    .label { font-size: 11px; color: #64748b; }
    
    &:active .icon { transform: scale(0.95); background-color: #f8fafc; }
}

.wechat .icon { color: #07c160; }
.qq .icon { color: #12b7f5; }
.phone .icon { color: #334155; }

/* Modal Styles */
.modal-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-content {
    background: #fff;
    width: 80%;
    border-radius: 12px;
    overflow: hidden;
    padding: 20px;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    font-weight: 600;
    font-size: 16px;
    
    .close-btn { font-size: 24px; color: #999; line-height: 1; }
}

.qr-placeholder {
    width: 150px;
    height: 150px;
    background: #f8f9fa;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
}

.code-row {
    display: flex;
    gap: 10px;
    
    .code-input { flex: 1; margin-bottom: 0; }
    .send-btn { width: 100px; margin-bottom: 0; height: 48px; }
}
</style>
