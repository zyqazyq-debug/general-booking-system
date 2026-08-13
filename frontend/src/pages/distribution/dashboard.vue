<template>
  <DistributionDashboardImpl @back="goBack" />
</template>

<script setup lang="ts">
import { DistributionDashboardImpl } from '@/domains/distribution';

const goBack = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
  } else {
    uni.reLaunch({ url: '/pages/index/index' });
  }
};
</script>
