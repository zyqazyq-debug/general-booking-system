<template>
  <AppModal
      :visible="visible"
      :title="mode === 'CREATE' ? '导入服务' : '编辑收藏'"
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
      <scroll-view scroll-y class="edit-modal-scroll" :show-scrollbar="false">
          <view class="edit-modal-body">
                  <EditModalServiceSummary
                    :preview="preview"
                    :service-days="serviceDays"
                    :service-hours="serviceHours"
                  />

                  <view class="divider my-2"></view>

                  <EditModalFormSection
                    :mode="mode"
                    :preview="preview"
                    :form="form"
                    :preview-edit-price="previewEditPrice"
                    @update-field="updateForm"
                  />
          </view>
      </scroll-view>
      <template #footer>
          <view v-if="mode === 'UPDATE'" class="footer-actions">
              <AppButton type="error" outline :round="false" class="workspace-footer-action workspace-footer-action--outline-danger" @click="handleDelete">删除</AppButton>
              <AppButton type="info" outline :round="false" class="workspace-footer-action workspace-footer-action--outline-secondary" @click="saveAsCopy">另存</AppButton>
              <AppButton type="primary" :round="false" class="workspace-footer-action workspace-footer-action--primary" @click="confirm">保存</AppButton>
          </view>
          <AppButton v-else type="primary" :round="false" class="workspace-footer-primary-action workspace-footer-action--primary" @click="confirm">确认导入</AppButton>
      </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppModal from '@/components/AppModal.vue';
import AppButton from '@/components/AppButton.vue';
import { deleteDistributionCollection } from '../../api/distribution';
import { showAppConfirm } from '@/utils/app-confirm';
import EditModalServiceSummary from './components/EditModalServiceSummary.vue';
import EditModalFormSection from './components/EditModalFormSection.vue';
import { useEditModalDisplay } from './composables/useEditModalDisplay';

const props = defineProps<{
  visible: boolean,
  mode: 'CREATE' | 'UPDATE',
  preview: any,
  form: any
}>();

const emit = defineEmits(['update:visible', 'update:form', 'confirm', 'saveAsCopy', 'delete']);

const close = () => {
  emit('update:visible', false);
};

const handleDelete = async () => {
    if (!props.preview?.id) return;
    const res = await showAppConfirm({
        title: '确认删除',
        content: '删除后将无法恢复，且所有下级代理也将失效。确定要删除吗？',
        confirmColor: '#ef4444'
    });
    if (!res.confirm) return;
    
    try {
        await deleteDistributionCollection(props.preview.id);
        uni.showToast({ title: '已删除', icon: 'success' });
        emit('delete', props.preview.id);
        close();
    } catch (e: any) {
        const msg = e?.data?.message || e?.message || '删除失败';
        uni.showToast({ title: msg, icon: 'none' });
    }
};

const updateForm = (field: string, value: any) => {
  const newForm = { ...props.form, [field]: value };
  emit('update:form', newForm);
};

const confirm = () => {
  emit('confirm');
};

const saveAsCopy = () => {
  emit('saveAsCopy');
};

const { previewEditPrice, serviceDays, serviceHours } = useEditModalDisplay(
  computed(() => props.preview),
  computed(() => props.form),
);
</script>

<style lang="scss" scoped>
@use '@/styles/workspace-modal-footer.scss' as workspaceModalFooter;

.edit-modal-scroll {
    min-height: 0;
    height: 100%;
}

.edit-modal-body {
    padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
}

.divider {
    height: 1px;
    background-color: $uni-border-color;
    width: 100%;
}

.my-2 { margin: 10px 0; }

@include workspaceModalFooter.workspace-modal-footer-actions;
</style>
