<template>
  <ServiceEditImpl
    :id="queryId"
    @back="goBack"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { ServiceEditImpl } from '@/domains/service';

const queryId = ref('');

onLoad((options: any) => {
  queryId.value = options?.id || '';
});

const goBack = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
  } else {
    uni.reLaunch({
      url: '/pages/index/index',
    });
  }
};
</script>
