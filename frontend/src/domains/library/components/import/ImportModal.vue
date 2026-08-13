<template>
  <AppModal
    :visible="visible"
    title="导入服务"
    variant="workspace"
    :center-title="true"
    :scrollable="false"
    :show-scroll-hint="false"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
      <view class="modal-body">
        <input class="link-input mb-3" :value="importLink" placeholder="粘贴分享链接..." @input="updateLink" />
        <AppButton type="primary" block class="mb-3" @click="onImport">确认导入</AppButton>
        <view class="divider-text mb-3">或</view>
        <AppButton type="primary" outline block @click="onScan">扫码导入</AppButton>
        
        <view v-if="importType === 'REPARENT'" class="mt-4">
            <text class="text-danger small">⚠️ 警告：更换上游将改变您的进货价，并可能影响您所有下游代理的价格。</text>
        </view>
      </view>
  </AppModal>
</template>

<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import AppButton from '@/components/AppButton.vue';

const props = defineProps<{
  visible: boolean,
  importLink: string,
  importType?: string
}>();

const emit = defineEmits(['update:visible', 'update:importLink', 'confirm', 'scan']);

const close = () => {
  emit('update:visible', false);
};

const updateLink = (e: any) => {
  emit('update:importLink', e.detail.value);
};

const onImport = () => {
  emit('confirm');
};

const onScan = () => {
  emit('scan');
};
</script>

<style lang="scss" scoped>
.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow-y: auto;
}
.mb-3 { margin-bottom: 12px; }
.mt-4 { margin-top: 16px; }
.link-input {
  height: 36px;
  padding: 0 12px;
  font-size: 14px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  background-color: $uni-bg-color-hover;
}
.divider-text {
    text-align: center;
    color: $uni-text-color-placeholder;
    font-size: 12px;
}
.text-danger { color: $uni-color-error; }
.small { font-size: 11px; }
</style>
