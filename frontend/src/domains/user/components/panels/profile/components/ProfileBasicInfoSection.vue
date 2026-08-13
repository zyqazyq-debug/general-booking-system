<template>
  <view>
    <view class="section-title section-top-gap">{{ t('profile.basic_info') }}</view>
    <AppCard :bordered="false" :shadow="false" padding="16px" custom-class="profile-card">
        <view class="form-item">
          <text class="form-label">{{ t('login.username') }}</text>
          <input
            v-model="profileForm.username"
            class="profile-input"
            type="text"
            :placeholder="t('profile.username_placeholder')"
          />
        </view>
        <view class="form-item">
          <text class="form-label">{{ t('profile.email') }}</text>
          <input
            v-model="profileForm.email"
            class="profile-input"
            type="text"
            :placeholder="t('profile.email_placeholder')"
          />
        </view>
        <AppButton type="primary" block class="drawer-action" :disabled="savingProfile" @click="emit('submit')">
          {{ savingProfile ? t('profile.saving') : t('profile.save_profile') }}
        </AppButton>
    </AppCard>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';
import AppCard from '@/shared/components/AppCard.vue';

defineProps<{
  t: (key: string) => string;
  savingProfile: boolean;
  profileForm: { username: string; email: string };
}>();

const emit = defineEmits<{
  (e: 'submit'): void;
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

.section-top-gap {
  margin-top: 20px;
}

.form-item {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: $uni-text-color-grey;
}

.profile-input {
  width: 100%;
  height: 40px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
  font-size: 14px;
  color: $uni-text-color-secondary;
  background: $uni-bg-color;
  box-sizing: border-box;
}

.profile-input:focus {
  border-color: $uni-color-primary;
}

.drawer-action {
  width: 100%;
  height: 44px;
  line-height: 44px;
  border-radius: $uni-radius-base;
  font-size: 15px;
  margin-top: 10px;
}
</style>
