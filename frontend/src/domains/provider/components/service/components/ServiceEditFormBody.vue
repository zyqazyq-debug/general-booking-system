<template>
  <scroll-view class="service-modal-body" scroll-y :show-scrollbar="false">
    <view v-if="!loading" class="service-scroll-content-inner">
      <ServiceEditBasicFields :form="form" :rules="rules" :week-days-list="weekDaysList" @toggle-day="emit('toggle-day', $event)" />
      <ServiceEditNotesFields :form="form" />
    </view>
    <view v-else class="center-content">
      <text class="loading-text">加载中...</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import ServiceEditBasicFields from './ServiceEditBasicFields.vue';
import ServiceEditNotesFields from './ServiceEditNotesFields.vue';

defineProps<{
  loading: boolean;
  form: any;
  rules: any;
  weekDaysList: Array<{ val: number; label: string }>;
}>();

const emit = defineEmits<{
  (e: 'toggle-day', day: number): void;
}>();
</script>

<style scoped lang="scss">
.service-modal-body {
  min-height: 0;
  height: 100%;
  background-color: #fff;
  padding: 0;
}

.service-scroll-content-inner {
  padding: 8px 0 calc(10px + env(safe-area-inset-bottom));
  width: 100%;
  box-sizing: border-box;
}

.service-scroll-content-inner > view:not(.divider) {
  padding-left: 12px;
  padding-right: 12px;
}
</style>
