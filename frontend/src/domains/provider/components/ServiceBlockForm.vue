<template>
  <AppModal
    :visible="visible"
    title="临时休息设置"
    variant="workspace"
    :center-title="true"
    :show-scroll-hint="false"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
    <view class="modal-body">
      <ServiceBlockFormFields
        :form="form"
        :loading="loading"
        @start-date-change="onStartDateChange"
        @start-clock-change="onStartClockChange"
        @end-date-change="onEndDateChange"
        @end-clock-change="onEndClockChange"
        @cancel="close"
        @submit="submit"
      />

      <ServiceBlockExistingList
        :is-global="isGlobal"
        :global-loading="globalLoading"
        :global-blocks="globalBlocks"
        :format-range="formatRange"
        @refresh="loadGlobalBlocks"
        @edit="prepareEditGlobal"
        @delete="removeGlobal"
      />
    </view>
  </AppModal>
</template>

<script setup lang="ts">
import { toRef, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import ServiceBlockFormFields from './service-block/components/ServiceBlockFormFields.vue';
import ServiceBlockExistingList from './service-block/components/ServiceBlockExistingList.vue';
import { useServiceBlockFormState } from './service-block/composables/useServiceBlockFormState';
import { useServiceBlockActions } from './service-block/composables/useServiceBlockActions';

const props = defineProps<{
  visible: boolean;
  serviceId?: string; // Optional for global setting
}>();

const emit = defineEmits(['update:visible', 'success']);

const {
  form,
  isGlobal,
  globalLoading,
  globalBlocks,
  editingGlobalId,
  normalizeClockToHalfHour,
  parseDateTimeValue,
  setRange,
  onStartDateChange,
  onStartClockChange,
  onEndDateChange,
  onEndClockChange,
  initializeOnOpen,
  formatRange,
} = useServiceBlockFormState({
  serviceId: toRef(props, 'serviceId'),
});

const close = () => {
  emit('update:visible', false);
};

const { loading, loadGlobalBlocks, prepareEditGlobal, removeGlobal, submit } = useServiceBlockActions({
  serviceId: toRef(props, 'serviceId'),
  isGlobal,
  form,
  editingGlobalId,
  globalLoading,
  globalBlocks,
  setRange,
  normalizeClockToHalfHour,
  parseDateTimeValue,
  emitSuccess: () => emit('success'),
  close,
});

watch(
  () => props.visible,
  (val) => {
    if (!val) return;
    void initializeOnOpen(loadGlobalBlocks);
  },
);
</script>

<style lang="scss" scoped>
.modal-body {
    padding: $uni-spacing-lg $uni-spacing-base;
}
</style>
