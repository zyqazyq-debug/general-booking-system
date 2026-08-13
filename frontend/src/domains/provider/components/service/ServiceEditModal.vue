<template>
  <AppModal
      :visible="visible"
      :title="isEdit ? '编辑服务' : '新建服务'"
      variant="workspace"
      :center-title="true"
      :scrollable="false"
      :show-scroll-hint="false"
      body-padding="0"
      header-background="#f8fafc"
      header-padding="10px 12px"
      footer-padding="10px 12px calc(10px + env(safe-area-inset-bottom))"
      @update:visible="emit('update:visible', $event)"
      @close="close"
  >
      <ServiceEditFormBody
        :loading="loading"
        :form="form"
        :rules="rules"
        :week-days-list="weekDaysList"
        @toggle-day="toggleDay"
      />

      <template #footer>
      <ServiceEditFooterActions
        :is-edit="isEdit"
        :is-active="form.is_active"
        @status-change="onStatusChange"
        @delete="confirmDelete"
        @submit="submit"
      />
      </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import AppModal from '@/components/AppModal.vue';
import { useServiceEditState } from './composables/useServiceEditState';
import { useServiceEditActions } from './composables/useServiceEditActions';
import ServiceEditFormBody from './components/ServiceEditFormBody.vue';
import ServiceEditFooterActions from './components/ServiceEditFooterActions.vue';

const props = defineProps<{
  visible: boolean,
  serviceId?: string
}>();

const emit = defineEmits(['update:visible', 'saved']);

const userStore = useUserStore();
const close = () => {
  emit('update:visible', false);
};

const {
  loading,
  isEdit,
  form,
  rules,
  policy,
  weekDaysList,
  loadData,
  toggleDay,
  onStatusChange,
} = useServiceEditState({
  serviceId: toRef(props, 'serviceId'),
  ownerId: computed(() => userStore.userInfo?.id),
});

watch(() => props.visible, (val) => {
  if (!val) return;
  void loadData().then((ok) => {
    if (!ok) close();
  });
});

const { submit, confirmDelete } = useServiceEditActions({
  serviceId: toRef(props, 'serviceId'),
  form,
  rules,
  policy,
  onSaved: () => emit('saved'),
  onClose: close,
});
</script>

<style lang="scss" scoped>
</style>
