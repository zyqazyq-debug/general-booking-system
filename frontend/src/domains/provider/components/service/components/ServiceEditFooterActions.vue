<template>
  <view class="modal-footer">
    <view v-if="isEdit" class="footer-actions">
      <view class="status-toggle-compact">
        <switch
          :checked="isActive"
          color="#4e97fc"
          style="transform: scale(0.8)"
          @change="emit('status-change', $event)"
        />
      </view>
      <AppButton type="error" outline :round="false" class="workspace-footer-action workspace-footer-action--outline-danger flex-1" @click="emit('delete')">删除</AppButton>
      <AppButton type="primary" :round="false" class="workspace-footer-action workspace-footer-action--primary flex-1" @click="emit('submit')">保存</AppButton>
    </view>
    <AppButton v-else type="primary" :round="false" class="workspace-footer-primary-action workspace-footer-action--primary" @click="emit('submit')">立即创建</AppButton>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';

defineProps<{
  isEdit: boolean;
  isActive: boolean;
}>();

const emit = defineEmits<{
  (e: 'status-change', value: any): void;
  (e: 'delete'): void;
  (e: 'submit'): void;
}>();
</script>

<style scoped lang="scss">
@use '@/styles/workspace-modal-footer.scss' as workspaceModalFooter;

.modal-footer {
  padding: 12px 16px;
  border-top: 1px solid $uni-bg-color-grey;
  background-color: $uni-bg-color;
  flex-shrink: 0;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}

.status-toggle-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-right: 8px;
  gap: 2px;
}

.flex-1 {
  flex: 1;
}

@include workspaceModalFooter.workspace-modal-footer-actions;
</style>
