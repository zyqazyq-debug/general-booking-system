<template>
  <AppPage :with-navbar="false" :with-tabbar="false" padding="0">
    <view class="auth-layout">
      <view class="auth-header" role="banner">
        <text class="logo" role="heading" aria-level="1">通用预约</text>
        <text class="subtitle">{{ subtitle }}</text>
      </view>

      <view class="auth-body" role="main">
        <view v-if="title || hint" class="form-intro">
          <text v-if="title" class="form-title" role="heading" aria-level="2">{{ title }}</text>
          <text v-if="hint" class="form-hint">{{ hint }}</text>
        </view>
        
        <slot></slot>
        
        <view v-if="$slots.footer" class="auth-footer">
            <slot name="footer"></slot>
        </view>
      </view>
    </view>
  </AppPage>
</template>

<script setup lang="ts">
import AppPage from '@/components/AppPage.vue';

defineProps<{
    subtitle?: string;
    title?: string;
    hint?: string;
}>();
</script>

<style lang="scss" scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: $uni-spacing-lg $uni-spacing-base;
  padding-bottom: calc(#{$uni-spacing-base} + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, $uni-color-primary-light 0%, $uni-bg-color-grey 44%, $uni-bg-color-grey 100%);
  box-sizing: border-box;
}

.auth-header {
  text-align: center;
  margin-top: $uni-spacing-sm;
  margin-bottom: $uni-spacing-base;
  flex-shrink: 0;
}

.logo {
  font-size: 26px;
  font-weight: 700;
  color: $uni-text-color;
  letter-spacing: 1px;
  display: block;
}

.subtitle {
  font-size: $uni-font-size-sm;
  color: $uni-text-color-grey;
  margin-top: 6px;
  display: block;
}

.auth-body {
  background: $uni-bg-color;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-xl;
  padding: $uni-spacing-base;
  box-shadow: $uni-shadow-base;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.form-intro {
  margin-bottom: $uni-spacing-base;
}

.form-title {
  display: block;
  font-size: $uni-font-size-h2;
  line-height: 1.3;
  font-weight: $uni-font-weight-bold;
  color: $uni-text-color;
}

.form-hint {
  display: block;
  margin-top: $uni-spacing-xs;
  font-size: $uni-font-size-sm;
  color: $uni-text-color-grey;
}

.auth-footer {
  margin-top: auto;
  padding-top: $uni-spacing-base;
}
</style>
