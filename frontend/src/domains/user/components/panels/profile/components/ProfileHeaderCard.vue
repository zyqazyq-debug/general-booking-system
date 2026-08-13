<template>
  <AppCard :no-margin="true" custom-class="top-unified-card">
    <view class="profile-body">
      <view class="profile-main">
        <view class="avatar">
          <text class="avatar-icon">🧑</text>
        </view>
        <view class="profile-info">
          <text class="username">{{ username }}</text>
        </view>
      </view>
      <view class="profile-settings-action" @click="emit('settings')">
        <text class="profile-settings-icon">⚙️</text>
      </view>
    </view>
  </AppCard>
</template>

<script setup lang="ts">
import AppCard from '@/shared/components/AppCard.vue';

defineProps<{
  username?: string;
}>();

const emit = defineEmits<{
  (e: 'settings'): void;
}>();
</script>

<style lang="scss" scoped>
.profile-body {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 40px; /* Match toolbar height */
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.profile-main {
  display: flex;
  align-items: center;
  min-width: 0;
}

.avatar {
  width: 40px;
  height: 40px;
  background-color: $uni-bg-color-grey;
  border-radius: $uni-radius-circle;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  flex: 0 0 auto;
}

.avatar-icon {
  font-size: 30px;
}

.profile-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
}

.profile-settings-action {
  width: 40px;
  height: 40px;
  border-radius: $uni-radius-lg;
  background-color: $uni-bg-color-hover;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.profile-settings-icon {
  font-size: 16px;
}

.username {
  font-size: 15px;
  font-weight: 700;
  color: $uni-text-color;
  margin-bottom: 0;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
