<template>
  <view />
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';

onLoad((options) => {
  const raw = options as Record<string, any>;
  const slug = raw?.slug || raw?.s || raw?.token;
  if (slug) {
    uni.redirectTo({
      url: `/pages/booking/detail?slug=${encodeURIComponent(String(slug))}`,
    });
    return;
  }
  uni.switchTab({
    url: '/pages/index/index',
  });
});
</script>
