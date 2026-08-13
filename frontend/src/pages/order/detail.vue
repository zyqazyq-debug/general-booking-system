<template>
  <OrderDetailImpl
    :id="queryId"
    :role="queryRole"
    @back="goBack"
  />
</template>


<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { OrderDetailImpl } from '@/domains/order';

const queryId = ref('');
const queryRole = ref('');

onLoad((options?: Record<string, string>) => {
  queryId.value = options?.id || '';
  queryRole.value = options?.role || '';
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
