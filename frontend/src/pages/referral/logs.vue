<template>
  <ReferralLogsImpl @back="goBack" />
</template>

<script setup lang="ts">
import { ReferralLogsImpl } from '@/domains/referral';

const goBack = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
  } else {
    uni.reLaunch({ url: '/pages/index/index' });
  }
};
</script>
