<template>
  <OrderListImpl
    :tab="queryTab"
    :hide-tabs="queryHideTabs"
    :initial-id="queryInitialId"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { OrderListImpl } from '@/domains/order';

const queryTab = ref('CONSUMER');
const queryHideTabs = ref(false);
const queryInitialId = ref('');

onLoad((options?: Record<string, string>) => {
  queryTab.value = options?.tab || 'CONSUMER';
  queryHideTabs.value = options?.hideTabs === 'true';
  queryInitialId.value = options?.id || '';
});
</script>
