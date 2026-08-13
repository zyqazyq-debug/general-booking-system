<template>
  <view class="promo-card">
    <view class="promo-title">分享链接</view>
    <view class="promo-link">{{ promotionLink }}</view>
    <AppButton type="primary" outline size="small" class="mt-2" @click="copyPromotionLink">复制链接</AppButton>
    <view class="share-icons-section">
      <view class="share-icon-item" :class="{ active: profile.hostApp === 'telegram' }" @click="shareToApp('telegram')">
        <view class="icon-circle tg-blue">
          <text class="icon-emoji">✈️</text>
        </view>
        <text class="icon-label">Telegram</text>
      </view>
      <view class="share-icon-item" :class="{ active: profile.hostApp === 'wechat' }" @click="shareToApp('wechat')">
        <view class="icon-circle wx-green">
          <text class="icon-emoji">微</text>
        </view>
        <text class="icon-label">微信</text>
      </view>
      <view class="share-icon-item" :class="{ active: profile.hostApp === 'qq' }" @click="shareToApp('qq')">
        <view class="icon-circle qq-blue">
          <text class="icon-emoji">Q</text>
        </view>
        <text class="icon-label">QQ</text>
      </view>
    </view>
    <view class="promo-note">{{ noteText }}</view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { TELEGRAM_BOT_NAME } from '@/config/bot';
import { detectRuntimeProfile } from '@/utils/runtime-env';
import AppButton from '@/components/AppButton.vue';

const props = defineProps<{
  promotionLink: string;
  noteText: string;
}>();

const profile = ref(detectRuntimeProfile());

watch(
  () => props.promotionLink,
  () => {
    profile.value = detectRuntimeProfile();
  },
);

const copyPromotionLink = async () => {
  try {
    await uni.setClipboardData({ data: props.promotionLink });
    uni.showToast({ title: '分享链接已复制', icon: 'none', position: 'bottom' });
  } catch {
    uni.showToast({ title: '复制失败', icon: 'none', position: 'bottom' });
  }
};

const extractReferralCode = (url: string): string => {
  if (!url) return '';
  const pathMatch = url.match(/\/r\/([A-Za-z0-9_-]+)/);
  if (pathMatch?.[1]) return pathMatch[1].toUpperCase();
  const queryMatch = url.match(/[?&#]ref=([A-Za-z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1].toUpperCase();
  return '';
};

const buildTelegramReferralLink = (url: string): string => {
  const referralCode = extractReferralCode(url);
  if (!referralCode || !TELEGRAM_BOT_NAME) return '';
  const payload = `rf_${referralCode}`;
  if (payload.length > 64) return '';
  return `https://t.me/${TELEGRAM_BOT_NAME}?start=${encodeURIComponent(payload)}`;
};

const shareToApp = (app: 'telegram' | 'wechat' | 'qq') => {
  const link = props.promotionLink;
  const shareText = '🎁 推荐你使用通用预约系统，点击进入注册。';

  if (app === 'telegram') {
    const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
    const tg = globalWindow?.Telegram?.WebApp;
    const deepLink = buildTelegramReferralLink(link);
    const targetUrl = deepLink || link;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(targetUrl)}&text=${encodeURIComponent(shareText)}`;
    if (tg && typeof tg.openTelegramLink === 'function') {
      tg.openTelegramLink(shareUrl);
      return;
    }
    window.open(shareUrl, '_blank');
    return;
  }

  uni.showToast({
    title: `请点击右上角或手动分享到${app === 'wechat' ? '微信' : 'QQ'}`,
    icon: 'none',
    position: 'bottom',
  });
};
</script>

<style lang="scss" scoped>
.promo-card {
  background: $uni-bg-color;
  border-radius: $uni-radius-lg;
  padding: 14px;
  margin-bottom: 14px;
}

.promo-title {
  font-size: 15px;
  color: $uni-text-color;
  font-weight: 600;
  margin-bottom: 8px;
}

.promo-link {
  font-size: 12px;
  color: $uni-color-primary;
  line-height: 1.5;
  word-break: break-all;
  background: $uni-color-primary-light;
  border-radius: $uni-radius-base;
  padding: 8px 10px;
}

.promo-note {
  margin-top: 10px;
  font-size: 12px;
  color: $uni-text-color-secondary;
  line-height: 1.6;
}

.share-icons-section {
  margin-top: 14px;
  display: flex;
  justify-content: space-around;
  width: 100%;
}

.share-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.7;
}

.share-icon-item.active {
  opacity: 1;
}

.icon-circle {
  width: 40px;
  height: 40px;
  border-radius: $uni-radius-circle;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-emoji {
  color: $uni-bg-color;
  font-size: 16px;
  font-weight: 700;
}

.tg-blue { background-color: #0088cc; }
.wx-green { background-color: #07c160; }
.qq-blue { background-color: #12b7f5; }

.icon-label {
  font-size: 12px;
  color: $uni-text-color-grey;
}
</style>
