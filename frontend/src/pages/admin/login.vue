<template>
  <view class="page-container center-content" style="padding: 20px;">
    <text class="h2 mb-4">管理员登录</text>
    
    <view class="card" style="width: 100%;">
        <view class="card-body">
            <view class="mb-3">
                <text class="form-label">管理员账号</text>
                <input class="form-control" v-model="form.username" placeholder="admin" />
            </view>
            <view class="mb-4">
                <text class="form-label">密码</text>
                <input class="form-control" password v-model="form.password" placeholder="admin123" />
            </view>
            <button class="btn btn-primary" @click="submit">登录</button>
            <view class="text-center mt-3">
                <text class="text-muted" @click="goBack">返回用户登录</text>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { useUserStore } from '@/stores/user';
import { loginApi } from '@/api/user';

const userStore = useUserStore();
const form = reactive({
  username: '',
  password: ''
});

const submit = async () => {
    // For demo simplicity, use normal login but check role or use specific admin endpoint
    // In real app, might have separate auth endpoint
    try {
        if (form.username !== 'admin' || form.password !== 'admin123') {
             // Mock check for now if backend doesn't have pre-seeded admin
             // return uni.showToast({ title: '账号或密码错误', icon: 'none' });
        }

        const res = await loginApi(form);
        // Check if user has admin role
        if (!res.user.roles.includes('ADMIN')) {
             return uni.showToast({ title: '非管理员账号', icon: 'none' });
        }
        
        userStore.login(res.user, res.access_token);
        uni.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
            uni.reLaunch({ url: '/pages/admin/dashboard' });
        }, 1500);
    } catch (e) {
        console.error(e);
    }
};

const goBack = () => uni.navigateBack();
</script>