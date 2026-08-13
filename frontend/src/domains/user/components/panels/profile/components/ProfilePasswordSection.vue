<template>
  <view>
    <view class="section-title section-toggle section-top-gap" @click="emit('toggle')">
      <text>{{ t('profile.change_password') }}</text>
      <text class="section-toggle-arrow">{{ expanded ? '▾' : '▸' }}</text>
    </view>
    <AppCard v-if="expanded" :bordered="false" :shadow="false" padding="16px" custom-class="profile-card">
        <view class="form-item">
          <text class="form-label">{{ t('profile.old_password') }}</text>
          <input
            v-model="passwordForm.oldPassword"
            class="profile-input"
            type="password"
            password
            :placeholder="t('profile.old_password_placeholder')"
          />
        </view>
        <view class="form-item">
          <text class="form-label">{{ t('profile.new_password') }}</text>
          <input
            v-model="passwordForm.newPassword"
            class="profile-input"
            type="password"
            password
            :placeholder="t('profile.new_password_placeholder')"
          />
        </view>
        <view class="form-item">
          <text class="form-label">{{ t('profile.confirm_password') }}</text>
          <input
            v-model="passwordForm.confirmPassword"
            class="profile-input"
            type="password"
            password
            :placeholder="t('profile.confirm_password_placeholder')"
          />
        </view>
        <AppButton type="primary" block class="drawer-action" :disabled="savingPassword" @click="emit('submit')">
          {{ savingPassword ? t('profile.saving') : t('profile.save_password') }}
        </AppButton>
    </AppCard>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';
import AppCard from '@/shared/components/AppCard.vue';

defineProps<{
  t: (key: string) => string;
  expanded: boolean;
  savingPassword: boolean;
  passwordForm: { oldPassword: string; newPassword: string; confirmPassword: string };
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
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

.section-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-toggle-arrow {
  color: $uni-text-color-grey;
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
