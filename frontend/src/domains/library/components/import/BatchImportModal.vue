<template>
  <AppModal
      :visible="visible"
      :title="`批量导入 (${items.length})`"
      variant="workspace"
      :center-title="true"
      :scrollable="false"
      :show-scroll-hint="false"
      @update:visible="emit('update:visible', $event)"
      @close="close"
  >
      <view class="modal-body">
              <view class="mb-3">
                 <text class="form-label">统一加价设置</text>
                 <view class="input-wrapper">
                    <input class="batch-input" type="number" :value="form.markup_value" placeholder="0" @input="updateForm('markup_value', $event)" />
                    <text class="input-unit">{{ form.markup_type === 'PERCENT' ? '%' : '元' }}</text>
                    <view class="type-toggle">
                      <AppButton type="primary" size="small" :round="false" class="type-toggle-action" :outline="form.markup_type!=='FIXED'" @click="updateForm('markup_type', 'FIXED')">固定金额</AppButton>
                      <AppButton type="primary" size="small" :round="false" class="type-toggle-action" :outline="form.markup_type!=='PERCENT'" @click="updateForm('markup_type', 'PERCENT')">百分比</AppButton>
                    </view>
                 </view>
              </view>
              
              <view class="divider-text mb-2">包含以下服务</view>
              
              <view class="batch-list">
                  <view v-for="item in items" :key="item.listing_id" class="batch-item">
                      <text class="item-title">{{ item.title }}</text>
                      <text class="item-price">¥{{ item.base_price ?? item.price }}</text>
                  </view>
              </view>

              <AppButton type="primary" block class="mt-3" @click="confirm">确认全部导入</AppButton>
          </view>
  </AppModal>
</template>

<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import AppButton from '@/components/AppButton.vue';

const props = defineProps<{
  visible: boolean,
  items: any[],
  form: any
}>();

const emit = defineEmits(['update:visible', 'update:form', 'confirm']);

const close = () => {
  emit('update:visible', false);
};

const updateForm = (field: string, val: any) => {
  const value = val?.detail?.value !== undefined ? val.detail.value : val;
  const newForm = { ...props.form, [field]: value };
  emit('update:form', newForm);
};

const confirm = () => {
  emit('confirm');
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
.mt-3 { margin-top: 12px; }
.form-label { font-size: 13px; color: $uni-text-color-grey; margin-bottom: 6px; display: block; }
.input-wrapper { display: flex; align-items: center; gap: 8px; }
.batch-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  font-size: 14px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  background-color: $uni-bg-color-hover;
}
.input-unit { color: $uni-text-color-grey; font-size: 14px; width: 14px; text-align: center; }
.type-toggle { display: flex; gap: 4px; }
.type-toggle-action { min-width: 76px; }
.divider-text { text-align: center; color: $uni-text-color-placeholder; font-size: 12px; margin: 12px 0; }
.batch-list { border: 1px solid $uni-bg-color-grey; border-radius: $uni-radius-base; padding: 8px; max-height: 200px; overflow-y: auto; }
.batch-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid $uni-bg-color-hover; }
.item-title { font-size: 13px; color: $uni-text-color-secondary; }
.item-price { font-size: 13px; font-weight: 600; color: $uni-text-color; }
</style>
