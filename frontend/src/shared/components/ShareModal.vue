<template>
  <AppModal
    :visible="visible"
    title="分享服务"
    variant="workspace"
    :center-title="true"
    :scrollable="false"
    :show-scroll-hint="false"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
      <view class="modal-body">
        <view v-if="shareSummary" class="service-summary">
          <view class="summary-row">
            <text class="summary-label">名称</text>
            <text class="summary-value">{{ shareSummary.name }}</text>
          </view>
          <view class="summary-row">
            <text class="summary-label">时长</text>
            <text class="summary-value">{{ shareSummary.duration }}</text>
          </view>
          <view class="summary-row">
            <text class="summary-label">金额</text>
            <text class="summary-value summary-price">{{ shareSummary.price }}</text>
          </view>
        </view>
        <view class="qr-container">
          <canvas id="qrcode" canvas-id="qrcode" style="width: 200px; height: 200px;" />
        </view>
        <view class="link-box">
            <text class="link-text">{{ shareLink }}</text>
        </view>
        <AppButton type="primary" block class="copy-action" @click="copyLink">复制链接</AppButton>

        <view class="share-icons-section">
            <view class="share-icon-item" :class="{ active: profile.hostApp === 'telegram' }" @click="shareToApp('telegram')">
                <view class="icon-circle tg-blue">
                    <svg viewBox="0 0 24 24" class="svg-icon"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.11.02-1.93 1.23-5.46 3.62-.51.35-.98.52-1.4.51-.46-.01-1.35-.26-2.01-.48-.81-.27-1.45-.42-1.39-.89.03-.24.36-.49.99-.74 3.88-1.69 6.47-2.8 7.77-3.35 3.68-1.54 4.45-1.81 4.95-1.81.11 0 .36.03.52.16.13.11.17.26.19.37.02.09.02.26.01.38z"/></svg>
                </view>
                <text class="icon-label">Telegram</text>
            </view>
            <view class="share-icon-item" :class="{ active: profile.hostApp === 'wechat' }" @click="shareToApp('wechat')">
                <view class="icon-circle wx-green">
                    <svg viewBox="0 0 24 24" class="svg-icon"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.41 12.89c-.58.58-1.36.89-2.16.89-.8 0-1.58-.31-2.16-.89l-.25-.25-.25.25c-.58.58-1.36.89-2.16.89-.8 0-1.58-.31-2.16-.89-.58-.58-.89-1.36-.89-2.16 0-.8.31-1.58.89-2.16.58-.58 1.36-.89 2.16-.89.8 0 1.58.31 2.16.89l.25.25.25-.25c.58-.58 1.36-.89 2.16-.89.8 0 1.58.31 2.16.89.58.58.89 1.36.89 2.16 0 .8-.31 1.58-.89 2.16z"/></svg>
                </view>
                <text class="icon-label">微信</text>
            </view>
            <view class="share-icon-item" :class="{ active: profile.hostApp === 'qq' }" @click="shareToApp('qq')">
                <view class="icon-circle qq-blue">
                    <svg viewBox="0 0 24 24" class="svg-icon"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="5"/></svg>
                </view>
                <text class="icon-label">QQ</text>
            </view>
        </view>
        <view v-if="shareWakeTip" class="wake-tip">
          <text>{{ shareWakeTip }}</text>
        </view>
      </view>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, getCurrentInstance } from 'vue';
import UQRCode from 'uqrcodejs';
import AppButton from '@/components/AppButton.vue';
import AppModal from '@/components/AppModal.vue';
import { TELEGRAM_BOT_NAME } from '@/config/bot';
import { getApiBaseUrl } from '@/utils/env';

const props = defineProps<{
  visible: boolean;
  shareLink: string;
  shareTitle?: string;
  shareText?: string;
  shareSummary?: {
    name: string;
    price: string;
    duration: string;
  } | null;
  shareWakeTip?: string;
}>();

const emit = defineEmits(['update:visible']);

import { detectRuntimeProfile } from '@/utils/runtime-env';
const profile = ref(detectRuntimeProfile());

watch(() => props.visible, (val) => {
  if (val) {
    profile.value = detectRuntimeProfile();
  }
});

const close = () => {
  emit('update:visible', false);
};

const copyLink = () => {
  uni.setClipboardData({
    data: props.shareLink,
    success: () => {
      uni.showToast({ title: '链接已复制', icon: 'success', position: 'bottom' });
    }
  });
};

const extractImportCode = (shareUrl: string): string => {
  if (!shareUrl) return '';
  const directMatch = shareUrl.match(/[?&#](token|slug)=([A-Za-z0-9_-]+)/);
  if (directMatch) {
    return directMatch[2];
  }
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    const parsed = new URL(shareUrl, window.location.origin);
    const queryCode =
      parsed.searchParams.get('token') || parsed.searchParams.get('slug');
    if (queryCode) {
      return queryCode;
    }
    const hash = parsed.hash?.startsWith('#')
      ? parsed.hash.slice(1)
      : parsed.hash || '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex < 0) {
      return '';
    }
    const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
    return hashParams.get('token') || hashParams.get('slug') || '';
  } catch {
    return '';
  }
};

const buildTelegramDeepLink = (shareUrl: string): string => {
  const importCode = extractImportCode(shareUrl);
  if (!importCode || !TELEGRAM_BOT_NAME) {
    return '';
  }
  const startPayload = `ic_${importCode}`;
  if (startPayload.length > 64) {
    return '';
  }
  return `https://t.me/${TELEGRAM_BOT_NAME}?start=${encodeURIComponent(startPayload)}`;
};

const buildTelegramShareText = (params: {
  shareText: string;
  webAppUrl: string;
  botDeepLink: string;
}): string => {
  const lines: string[] = [];
  if (params.shareText) {
    lines.push(params.shareText);
  }
  lines.push('📌 已为你准备好收藏入口。');
  if (params.botDeepLink) {
    lines.push(`🤖 机器人收藏入口：${params.botDeepLink}`);
  }
  lines.push(`🌐 小程序页面：${params.webAppUrl}`);
  return lines.join('\n');
};

const reportShareEvent = (event: string, payload: Record<string, unknown>) => {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  uni.request({
    url: `${base}/debug/log`,
    method: 'POST',
    data: {
      event,
      scene: 'telegram_share_modal',
      ...payload,
    },
  });
};

const shareToApp = (app: 'telegram' | 'wechat' | 'qq') => {
  const shareUrl = props.shareLink;
  const shareText = props.shareText || props.shareTitle || '';

  if (app === 'telegram') {
    const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
    const tg = globalWindow?.Telegram?.WebApp;
    const botDeepLink = buildTelegramDeepLink(shareUrl);
    reportShareEvent('TG_SHARE_OPEN', {
      hasBotDeepLink: Boolean(botDeepLink),
      shareLinkLength: shareUrl.length,
      runtimeHost: profile.value.hostApp,
    });
    const telegramText = buildTelegramShareText({
      shareText,
      webAppUrl: shareUrl,
      botDeepLink,
    });
    const telegramTargetUrl = botDeepLink || shareUrl;
    const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(telegramTargetUrl)}&text=${encodeURIComponent(telegramText)}`;
    
    if (tg && typeof tg.openTelegramLink === 'function') {
      try {
        tg.openTelegramLink(telegramShareUrl);
        reportShareEvent('TG_SHARE_LINK_OPENED', {
          method: 'openTelegramLink',
          fallbackToWebApp: !botDeepLink,
        });
        uni.showToast({
          title: botDeepLink
            ? '已打开电报发送页，请选择消费者'
            : '已回退为小程序链接，请选择消费者',
          icon: 'none',
          position: 'bottom',
        });
        return;
      } catch (e) {
        console.error('TG open link error:', e);
        reportShareEvent('TG_SHARE_LINK_ERROR', {
          method: 'openTelegramLink',
          fallbackToWindowOpen: true,
        });
      }
    }
    window.open(telegramShareUrl, '_blank');
    reportShareEvent('TG_SHARE_LINK_OPENED', {
      method: 'windowOpen',
      fallbackToWebApp: !botDeepLink,
    });
    uni.showToast({
      title: botDeepLink
        ? '已打开电报发送页，请选择消费者'
        : '已回退为小程序链接，请选择消费者',
      icon: 'none',
      position: 'bottom',
    });
  } else if (app === 'wechat' || app === 'qq') {
    // Mini-programs handle sharing via button open-type="share" or menu.
    // For H5, we can only suggest copying link or provide a hint.
    uni.showToast({ title: `请点击右上角或手动分享到${app === 'wechat' ? '微信' : 'QQ'}`, icon: 'none', position: 'bottom' });
  }
};

const generateQR = async () => {
  await nextTick();
  try {
      // Get the canvas context
      // In Vue 3 + UniApp, we need to pass 'this' context for components
      // But in setup script, we use getCurrentInstance
      const instance = getCurrentInstance();
      const ctx = uni.createCanvasContext('qrcode', instance?.proxy || instance);
      
      // Instantiate
      const qr = new UQRCode();
      // Set options
      qr.data = props.shareLink;
      qr.size = 200;
      qr.make();
      qr.canvasContext = ctx;
      qr.drawCanvas();
  } catch (e) {
      console.error('QR Gen Error:', e);
  }
};

watch(() => props.visible, (val) => {
  if (val && props.shareLink) {
    // Slight delay to ensure canvas is rendered
    setTimeout(() => {
        generateQR();
    }, 100);
  }
});
</script>

<style lang="scss" scoped>
.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.service-summary {
  width: 100%;
  background-color: $uni-bg-color-hover;
  border-radius: 10px;
  border: 1px solid $uni-border-color;
  margin-bottom: 16px;
  padding: 10px 12px;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  line-height: 1.5;
}

.summary-row + .summary-row {
  margin-top: 6px;
}

.summary-label {
  color: $uni-text-color-grey;
}

.summary-value {
  color: $uni-text-color;
  font-weight: 500;
  text-align: right;
}

.summary-price {
  color: #16a34a;
  font-weight: 600;
}

.qr-container {
  width: 200px;
  height: 200px;
  margin-bottom: 20px;
  background-color: $uni-bg-color-hover;
}

.link-box {
    background-color: $uni-bg-color-grey;
    padding: 10px;
    border-radius: 6px;
    width: 100%;
    margin-bottom: 16px;
    word-break: break-all;
}
.link-text {
    font-size: 12px;
    color: $uni-text-color-grey;
}

.copy-action {
    width: 100%;
    border-radius: 24px;
}

.share-icons-section {
    margin-top: 24px;
    display: flex;
    justify-content: space-around;
    width: 100%;
    border-top: 1px solid $uni-bg-color-grey;
    padding-top: 20px;
}

.wake-tip {
  margin-top: 12px;
  width: 100%;
  font-size: 12px;
  line-height: 1.5;
  color: $uni-text-color-grey;
  background: $uni-bg-color-hover;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 8px 10px;
}

.share-icon-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    opacity: 0.6;
    transition: all 0.2s;
}

.share-icon-item.active {
    opacity: 1;
    transform: scale(1.1);
}

.icon-circle {
    width: 48px;
    height: 48px;
    border-radius: $uni-radius-circle;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.tg-blue { background-color: #0088cc; }
.wx-green { background-color: #07c160; }
.qq-blue { background-color: #12b7f5; }

.svg-icon {
    width: 28px;
    height: 28px;
    fill: $uni-bg-color;
}

.icon-label {
    font-size: 12px;
    color: $uni-text-color-grey;
}
</style>
