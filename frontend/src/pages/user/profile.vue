<template>
  <AppPage title="我的" :with-navbar="false" :with-tabbar="true" :padding="PAGE_SHELL_PADDING">
    <ProfilePanel ref="panelRef" :referral-income-renderer="ReferralLogsComponent" />
    <template #tabbar>
      <AppTabBar />
    </template>
  </AppPage>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { ProfilePanel } from '@/domains/user';
import { ReferralLogsComponent } from '@/domains/referral';
import { PAGE_SHELL_PADDING } from '@/constants/layout-shell';

const isFirstShow = ref(true);
const panelRef = ref<any>(null);

onShow(() => {
    if (isFirstShow.value) {
        isFirstShow.value = false;
        return;
    }
    panelRef.value?.refresh?.();
});
</script>
