<template>
    <HelpIndexImpl :hide-tabs="queryHideTabs" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { HelpIndexImpl } from '@/domains/help';

const queryHideTabs = ref(false);

onLoad((options?: Record<string, string>) => {
    queryHideTabs.value = options?.hideTabs === 'true';
});
</script>