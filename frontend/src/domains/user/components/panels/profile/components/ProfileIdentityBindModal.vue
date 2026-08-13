<template>
  <AppModal v-model:visible="visibleModel" :title="title" @close="emit('close')">
    <view class="drawer-body">
      <AppCard :bordered="false" :shadow="false" padding="16px" custom-class="profile-card">
          <text class="muted-text hint-text">{{ hint }}</text>

          <view v-if="currentBindProvider === 'telegram'" class="telegram-tip">
            <view class="tip-title">方法 A：直接跳转</view>
            <view class="tip-desc">点击下方按钮跳转到机器人对话框，点击「开始」即可。</view>
            <view class="tip-title">方法 B：手动发送消息</view>
            <view>
              给机器人
              <text class="bot-username">@{{ identityScanBotInfo.username || '...' }}</text>
              发送消息：
              <text class="ticket-code">/start {{ identityScanTicketId }}</text>
            </view>
          </view>

          <view v-if="bindingIdentity && !identityScanQrUrl" class="loading-scan">
            <text class="muted-text">正在为您准备绑定链接...</text>
          </view>

          <view v-if="identityScanQrUrl" class="scan-area">
            <view v-if="currentBindProvider === 'telegram'" class="telegram-link-box">
              <view v-if="!isMobile" class="qr-box">
                <text class="muted-text qr-title">请使用手机 Telegram 扫码：</text>
                <view class="qr-canvas-wrap">
                  <canvas id="tg-bind-qr" canvas-id="tg-bind-qr" class="qr-canvas" />
                </view>
              </view>
              <text class="muted-text action-tip">
                {{ isMobile ? '请点击下方按钮跳转到 Telegram 机器人完成绑定：' : '或点击链接直接打开：' }}
              </text>
              <view class="action-group">
                <AppButton type="primary" class="flex-action" @click="emit('open-telegram-link')">
                  🚀 {{ isMobile ? '跳转到机器人' : '桌面版打开' }}
                </AppButton>
                <AppButton v-if="!isMobile" type="info" outline class="flex-action" @click="emit('open-telegram-web')">🌐 网页版打开</AppButton>
              </view>
            </view>
            <view v-else class="qr-placeholder">
              <text class="muted-text">此处将显示 {{ providerLabelMap[currentBindProvider] }} 绑定二维码</text>
              <text class="muted-text sub-tip">（扫码功能正在接入中）</text>
            </view>
          </view>

          <AppButton
            v-if="currentBindProvider !== 'telegram' || !identityScanQrUrl"
            type="primary"
            block
            class="drawer-action"
            :disabled="bindingIdentity"
            @click="emit('start-scan', false)"
          >
            {{ bindingIdentity ? '正在生成...' : (identityScanQrUrl ? '重新生成链接' : '获取绑定链接/二维码') }}
          </AppButton>
          <AppButton
            type="info"
            outline
            block
            class="drawer-action"
            :disabled="bindingIdentity || !identityScanTicketId"
            @click="emit('check-status')"
          >
            {{ bindingIdentity ? '查询中...' : '我已完成操作，检查状态' }}
          </AppButton>
      </AppCard>
    </view>
  </AppModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppModal from '@/shared/components/AppModal.vue';
import AppButton from '@/shared/components/AppButton.vue';
import AppCard from '@/shared/components/AppCard.vue';

type BindProvider = 'wechat' | 'qq' | 'telegram';

const props = defineProps<{
  visible: boolean;
  title: string;
  hint: string;
  currentBindProvider: BindProvider;
  identityScanBotInfo: { username?: string; name?: string };
  identityScanTicketId: string;
  bindingIdentity: boolean;
  identityScanQrUrl: string;
  isMobile: boolean;
  providerLabelMap: Record<BindProvider, string>;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'close'): void;
  (e: 'start-scan', isAuto: boolean): void;
  (e: 'check-status'): void;
  (e: 'open-telegram-link'): void;
  (e: 'open-telegram-web'): void;
}>();

const visibleModel = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});
</script>

<style lang="scss" scoped>
.drawer-body {
  padding: 16px;
  background-color: $uni-bg-color-grey;
  min-height: 100%;
}

.hint-text {
  display: block;
  margin-bottom: 15px;
}

.telegram-tip {
  margin-bottom: 15px;
  font-size: 12px;
  color: $uni-text-color-grey;
  background: $uni-bg-color-hover;
  padding: 10px;
  border-radius: 6px;
}

.tip-title {
  margin-bottom: 4px;
  font-weight: bold;
}

.tip-desc {
  margin-bottom: 8px;
}

.bot-username {
  color: $uni-color-primary-dark;
  font-weight: bold;
}

.ticket-code {
  color: $uni-color-primary-dark;
  font-weight: bold;
  background: $uni-border-color;
  padding: 2px 4px;
  border-radius: $uni-radius-sm;
}

.loading-scan {
  text-align: center;
  padding: 40px 0;
}

.scan-area {
  text-align: center;
  margin-bottom: 20px;
}

.qr-box {
  margin-bottom: 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qr-title {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
}

.qr-canvas-wrap {
  padding: 10px;
  background: white;
  border-radius: $uni-radius-base;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.qr-canvas {
  width: 180px;
  height: 180px;
}

.action-tip {
  display: block;
  margin-bottom: 10px;
}

.action-group {
  display: flex;
  gap: 10px;
}

.flex-action {
  flex: 1;
}

.qr-placeholder {
  padding: 30px;
  background: #f8f9fa;
  border-radius: $uni-radius-base;
}

.sub-tip {
  display: block;
  font-size: 12px;
  margin-top: 10px;
}

.drawer-action {
  margin-top: 10px;
}

.muted-text {
  color: $uni-text-color-placeholder;
  font-size: 12px;
}
</style>
