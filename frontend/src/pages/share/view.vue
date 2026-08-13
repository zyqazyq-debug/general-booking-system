<template>
  <AppPage title="分享详情" :with-navbar="true" :show-back="true">
      <view class="share-page">
          <AppCard v-if="loading" :padding="'16px'" class="share-card">
              <text class="muted-text">正在加载分享内容...</text>
          </AppCard>

          <AppCard v-else-if="error" :padding="'16px'" class="share-card">
              <text class="error-title">加载失败</text>
              <text class="muted-text support-text">{{ error }}</text>
              <AppButton type="primary" block class="error-action-gap" @click="goHome">返回首页</AppButton>
          </AppCard>

          <AppCard v-else-if="shareItem" :padding="'0'" class="share-card">
              <template #header>
                  <view class="share-header">
                      <text class="share-title">{{ shareItem.title }}</text>
                  </view>
              </template>
              <view class="share-body">
                  <view class="info-row info-gap-sm">
                      <text class="muted-text">发布者</text>
                      <text>{{ shareItem.owner_name }}</text>
                  </view>
                  <view class="info-row info-gap-lg">
                      <text class="muted-text">价格</text>
                      <text class="price-highlight text-bold">¥{{ shareItem.base_price }}</text>
                  </view>
                  
                  <AppButton type="primary" block @click="handleImport">添加到我的代理库</AppButton>
                  <AppButton type="info" outline block class="secondary-action-gap" @click="goHome">返回首页</AppButton>
              </view>
          </AppCard>
      </view>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getShareLink } from '@/domains/distribution';
import { request } from '@/utils/request';
import { useUserStore } from '@/shared/stores/user';
import { isCollectionExistsError, isSelfCollectionError } from '@/utils/error-code';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';
import AppButton from '@/shared/components/AppButton.vue';

const userStore = useUserStore();
const token = ref('');
const loading = ref(true);
const error = ref('');
const shareData = ref<any>(null);
const shareItem = computed(() => {
    const payload = shareData.value?.data;
    if (Array.isArray(payload)) return payload[0] || null;
    return payload || null;
});

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
        const res = await getShareLink(token.value);
        shareData.value = res;
    } catch (e: any) {
        error.value = e.message || '链接失效或网络错误';
    } finally {
        loading.value = false;
    }
};

const handleImport = async () => {
    try {
        uni.showLoading({ title: '正在添加...' });

        const currentUserId = userStore.userInfo?.id;
        const sourceOwnerId = shareItem.value?.owner_id;
        const sourceServiceId = shareItem.value?.source_service_id;
        if (currentUserId && sourceOwnerId && currentUserId === sourceOwnerId) {
            uni.showToast({ title: '这是你自己的分享，无需收藏', icon: 'none' });
            return;
        }
        if (currentUserId && sourceServiceId) {
            const collection: any = await request({
                url: '/agency/collection',
                method: 'GET',
                hideLoading: true,
                hideErrorToast: true,
            });
            if (Array.isArray(collection) && collection.some((item: any) => item?.service_id === sourceServiceId && item?.status === 'ACTIVE')) {
                uni.showToast({ title: '该分享已在你的收藏中', icon: 'none' });
                return;
            }
        }
        
        const res: any = await request({ 
            url: '/agency/collection', 
            method: 'POST', 
            data: { listingId: shareItem.value?.listing_id } 
        });

        if (res?.auth?.access_token && res?.auth?.refresh_token && res?.auth?.user) {
            userStore.login(res.auth.user, res.auth.access_token, res.auth.refresh_token);
        }
        
        uni.showToast({ title: '已添加到代理库', icon: 'success' });
        setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500);

    } catch (e: any) {
        if (isSelfCollectionError(e)) {
            uni.showToast({ title: '这是你自己的分享，无需收藏', icon: 'none' });
            return;
        }
        if (isCollectionExistsError(e)) {
            uni.showToast({ title: '该分享已在你的收藏中', icon: 'none' });
            return;
        }
        uni.showToast({ title: '添加失败', icon: 'none' });
    } finally {
        uni.hideLoading();
    }
};

const goHome = () => uni.reLaunch({ url: '/pages/index/index' });
</script>

<style lang="scss" scoped>
.share-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: calc(100vh - 64px);
    padding-top: 20px;
}
.share-card {
    width: 100%;
    max-width: 720rpx;
}
.share-header {
    width: 100%;
    text-align: center;
}
.share-title {
    font-size: 24px;
    font-weight: 700;
    color: $uni-text-color;
}
.share-body {
    padding: 16px;
}
.info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.muted-text {
    color: $uni-text-color-placeholder;
}
.support-text {
    font-size: 12px;
}
.error-action-gap {
    margin-top: 16px;
}
.info-gap-sm {
    margin-bottom: 8px;
}
.info-gap-lg {
    margin-bottom: 16px;
}
.price-highlight {
    color: $uni-color-primary;
}
.secondary-action-gap {
    margin-top: 8px;
}
.text-bold { font-weight: 600; }
.error-title {
    color: $uni-color-error;
    margin-bottom: 8px;
}
</style>
