<template>
  <view>
    <view class="section-title">{{ t('profile.accounts') }}</view>
    <AppCard :bordered="false" :shadow="false" padding="0" custom-class="menu-card">
      <view class="menu-item" @click="emit('bind-phone')">
        <view class="left">
          <text class="icon">📱</text>
          <text>{{ t('profile.bind_phone') }}</text>
        </view>
        <view class="right-val">
          <text class="text-muted mr-1 right-val-text">
            {{ userStore.userInfo?.phone ? `${userStore.userInfo.phone}（点击修改）` : t('profile.click_to_bind') }}
          </text>
          <text class="arrow">›</text>
        </view>
      </view>

      <view class="menu-item" @click="emit('open-provider', 'telegram')">
        <view class="left">
          <text class="icon">✈️</text>
          <text>{{ t('profile.bind_telegram') }}</text>
        </view>
        <view class="right-val">
          <text class="text-muted mr-1 right-val-text">{{ telegramAccountDisplay }}</text>
          <text
            v-if="userStore.userInfo?.telegram_chat_id"
            class="unbind-action"
            @click.stop="emit('unbind-provider', 'telegram')"
          >
            解绑
          </text>
          <text v-else class="arrow">›</text>
        </view>
      </view>

      <view class="menu-item" @click="emit('open-provider', 'wechat')">
        <view class="left">
          <text class="icon">💬</text>
          <text>{{ t('profile.bind_wechat') }}</text>
        </view>
        <view class="right-val">
          <text class="text-muted mr-1 right-val-text">{{ wechatAccountDisplay }}</text>
          <text
            v-if="userStore.userInfo?.wechat_openid"
            class="unbind-action"
            @click.stop="emit('unbind-provider', 'wechat')"
          >
            解绑
          </text>
          <text v-else class="arrow">›</text>
        </view>
      </view>

      <view class="menu-item" @click="emit('open-provider', 'qq')">
        <view class="left">
          <text class="icon">🐧</text>
          <text>{{ t('profile.bind_qq') }}</text>
        </view>
        <view class="right-val">
          <text class="text-muted mr-1 right-val-text">{{ qqAccountDisplay }}</text>
          <text
            v-if="userStore.userInfo?.qq_openid"
            class="unbind-action"
            @click.stop="emit('unbind-provider', 'qq')"
          >
            解绑
          </text>
          <text v-else class="arrow">›</text>
        </view>
      </view>
    </AppCard>
  </view>
</template>

<script setup lang="ts">
import AppCard from '@/shared/components/AppCard.vue';

type BindProvider = 'wechat' | 'qq' | 'telegram';

defineProps<{
  t: (key: string) => string;
  userStore: any;
  telegramAccountDisplay: string;
  wechatAccountDisplay: string;
  qqAccountDisplay: string;
}>();

const emit = defineEmits<{
  (e: 'bind-phone'): void;
  (e: 'open-provider', provider: BindProvider): void;
  (e: 'unbind-provider', provider: BindProvider): void;
}>();
</script>

<style lang="scss" scoped>
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: $uni-text-color-grey;
  margin-bottom: 8px;
  padding-left: 4px;
}

.menu-card {
  margin-bottom: 12px;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid $uni-bg-color-grey;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  gap: 8px;
}

.menu-item:active {
  background-color: $uni-bg-color-hover;
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item .left {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: $uni-text-color-secondary;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.menu-item .icon {
  margin-right: 10px;
  font-size: 16px;
  flex: 0 0 auto;
  width: 24px;
  text-align: center;
}

.menu-item .right-val {
  display: flex;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
  flex: 1;
  justify-content: flex-end;
  gap: 4px;
}

.menu-item .right-val .right-val-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: right;
  font-size: 13px;
}

.menu-item .arrow {
  color: #cbd5e1;
  font-size: 14px;
  white-space: nowrap;
  flex: 0 0 auto;
}

.unbind-action {
  font-size: 12px;
  color: $uni-color-error;
  padding: 2px 6px;
  background: #fee2e2;
  border-radius: $uni-radius-sm;
}

.text-muted {
  color: $uni-text-color-placeholder;
  font-size: 12px;
}
</style>
