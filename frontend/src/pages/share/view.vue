<template>
  <view class="page-container center-content">
      <view class="card p-4" v-if="loading">
          <text class="text-muted">正在加载分享内容...</text>
      </view>

      <view class="card p-4" v-else-if="error">
          <text class="text-danger mb-2">加载失败</text>
          <text class="text-muted text-sm">{{ error }}</text>
          <button class="btn btn-primary mt-4" @click="goHome">返回首页</button>
      </view>

      <view class="card" v-else-if="shareData">
          <view class="card-header text-center">
              <text class="h2">{{ shareData.data.title }}</text>
          </view>
          <view class="card-body">
              <view class="d-flex justify-between mb-2">
                  <text class="text-muted">发布者</text>
                  <text>{{ shareData.data.owner_name }}</text>
              </view>
              <view class="d-flex justify-between mb-4">
                  <text class="text-muted">价格</text>
                  <text class="text-primary font-bold">¥{{ shareData.data.price }}</text>
              </view>
              
              <button class="btn btn-primary w-100" @click="handleImport">添加到我的代理库</button>
              <button class="btn btn-outline mt-2 w-100" @click="goHome">返回首页</button>
          </view>
      </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { resolveShareLink } from '@/api/share-link';
import { request } from '@/utils/request';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const token = ref('');
const loading = ref(true);
const error = ref('');
const shareData = ref<any>(null);

onLoad((options: any) => {
    if (options.token) {
        token.value = options.token;
        loadShareContent();
    } else {
        error.value = '无效的分享链接';
        loading.value = false;
    }
});

const loadShareContent = async () => {
    try {
        const res = await resolveShareLink(token.value);
        shareData.value = res;
    } catch (e: any) {
        error.value = e.message || '链接失效或网络错误';
    } finally {
        loading.value = false;
    }
};

const handleImport = async () => {
    if (!userStore.userInfo) {
        uni.showToast({ title: '请先登录', icon: 'none' });
        setTimeout(() => uni.navigateTo({ url: '/pages/login/login' }), 1000);
        return;
    }

    try {
        uni.showLoading({ title: '正在添加...' });
        
        // Import via listing ID
        await request({ 
            url: '/agency/collection', 
            method: 'POST', 
            data: { listingId: shareData.value.data.listing_id } 
        });
        
        uni.showToast({ title: '已添加到代理库', icon: 'success' });
        setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 1500);

    } catch (e) {
        uni.showToast({ title: '添加失败', icon: 'none' });
    } finally {
        uni.hideLoading();
    }
};

const goHome = () => uni.switchTab({ url: '/pages/index/index' });
</script>

<style>
.center-content {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 80vh;
}
.w-100 { width: 100%; }
.btn-outline { background: transparent; border: 1px solid #ccc; color: #666; }
</style>