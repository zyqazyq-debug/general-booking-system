<template>
  <view class="page-container center-content" style="padding: 20px;">
    <view class="card" style="width: 100%;">
        <view class="card-body">
            <view class="mb-3">
                <text class="form-label">{{ $t('login.username') }}</text>
                <input class="form-control" type="text" v-model="form.username" :placeholder="$t('login.username_placeholder')" />
            </view>
            <view class="mb-3">
                <text class="form-label">{{ $t('login.password') }}</text>
                <input class="form-control" type="password" v-model="form.password" :placeholder="$t('login.password_placeholder')" />
            </view>
            <button class="btn btn-primary" @click="submit">{{ $t('login.create_account') }}</button>
            <view class="text-center mt-2">
                <text class="text-primary" @click="goToLogin">{{ $t('login.has_account') }}</text>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { registerApi } from '@/api/user';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const form = reactive({
  username: '',
  password: ''
});

const submit = async () => {
  if (!form.username || !form.password) return uni.showToast({ title: 'Missing fields', icon: 'none' });
  
  try {
    const payload = {
        username: form.username,
        password: form.password,
        roles: ['CONSUMER']
    };
    const res = await registerApi(payload);
    userStore.login(res.user, res.access_token);
    
    uni.showToast({ title: 'Welcome!', icon: 'success' });
    setTimeout(() => {
        uni.reLaunch({ url: '/pages/index/index' });
    }, 1500);
  } catch (e) {
    console.error(e);
  }
};

const goToLogin = () => {
  uni.navigateTo({ url: '/pages/login/login' });
};
</script>

<style scoped>
.page-container {
  height: calc(100vh - var(--window-top));
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
  box-sizing: border-box;
}
</style>
