<template>
  <view v-if="visible" class="share-modal-mask" @click="close">
    <view class="share-modal-content" @click.stop>
      <view class="modal-header">
        <text class="modal-title">分享服务</text>
        <text class="close-btn" @click="close">×</text>
      </view>
      
      <view class="modal-body">
        <view class="qr-container">
          <canvas id="qrcode" canvas-id="qrcode" style="width: 200px; height: 200px;" />
        </view>
        <view class="link-box">
            <text class="link-text">{{ shareLink }}</text>
        </view>
        <button class="btn btn-primary copy-btn" @click="copyLink">复制链接</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, getCurrentInstance } from 'vue';
import UQRCode from 'uqrcodejs';

const props = defineProps<{
  visible: boolean;
  shareLink: string;
}>();

const emit = defineEmits(['update:visible']);

const close = () => {
  emit('update:visible', false);
};

const copyLink = () => {
  uni.setClipboardData({
    data: props.shareLink,
    success: () => {
      uni.showToast({ title: '链接已复制', icon: 'success' });
    }
  });
};

const generateQR = async () => {
  await nextTick();
  try {
      // Get the canvas context
      // In Vue 3 + UniApp, we need to pass 'this' context for components
      // But in setup script, we use getCurrentInstance
      const instance = getCurrentInstance();
      const ctx = uni.createCanvasContext('qrcode', instance);
      
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

<style>
.share-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-modal-content {
  width: 85%;
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
  padding-bottom: 20px;
}

.modal-header {
  padding: 16px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.close-btn {
  font-size: 24px;
  color: #94a3b8;
  line-height: 1;
}

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qr-container {
  width: 200px;
  height: 200px;
  margin-bottom: 20px;
  background-color: #f8fafc;
}

.link-box {
    background-color: #f1f5f9;
    padding: 10px;
    border-radius: 6px;
    width: 100%;
    margin-bottom: 16px;
    word-break: break-all;
}
.link-text {
    font-size: 12px;
    color: #64748b;
}

.copy-btn {
    width: 100%;
    border-radius: 24px;
}
</style>