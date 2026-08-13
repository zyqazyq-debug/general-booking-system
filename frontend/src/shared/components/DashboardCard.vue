<template>
  <view class="dashboard-card" :class="[customClass, { 'no-margin': noMargin }]">
    <view class="dashboard-card-header">
      <text class="dashboard-card-title">{{ title }}</text>
      <view class="dashboard-card-extra">
        <slot name="extra"></slot>
        <slot name="action"></slot>
      </view>
    </view>
    <view class="dashboard-card-body" :style="{ padding: padding }">
      <slot></slot>
    </view>
  </view>
</template>

<script setup lang="ts">
interface Props {
    title?: string;
    padding?: string;
    customClass?: string;
    noMargin?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    title: '',
    padding: '12px',
    customClass: '',
    noMargin: false
});
</script>

<style lang="scss" scoped>
.dashboard-card {
  background-color: $uni-bg-color;
  border-radius: $uni-radius-lg;
  margin-bottom: $uni-spacing-base;
  overflow: hidden;
  box-shadow: $uni-shadow-sm;
  border: 1px solid $uni-border-color;
  z-index: $uni-z-base;
  position: relative;
}

.dashboard-card.no-margin {
  margin-bottom: 0 !important;
}

.dashboard-card-header {
  height: 44px;
  padding: 0 $uni-spacing-base;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid $uni-border-color-light;
  background-color: #fcfcfc;
}

.dashboard-card-title {
  font-size: $uni-font-size-h2;
  font-weight: $uni-font-weight-bold;
  color: $uni-text-color;
  line-height: 1;
}

.dashboard-card-extra {
  display: flex;
  align-items: center;
}

.dashboard-card-body {
  width: 100%;
  box-sizing: border-box;
}
</style>
