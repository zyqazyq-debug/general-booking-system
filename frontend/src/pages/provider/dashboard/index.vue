<template>
  <view v-if="isPC" class="pc-root">
    <PCDashboard />
  </view>
  <MobileDashboard v-else />
  </template>

<script setup lang="ts">
import MobileDashboard from './MobileDashboard.vue';
import PCDashboard from './PCDashboard.vue';
import { usePCMode } from '@/core/ui/usePCMode';

const { isPC } = usePCMode();
</script>

<style scoped>
.pc-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
