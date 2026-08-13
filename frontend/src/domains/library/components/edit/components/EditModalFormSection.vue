<template>
  <view>
    <view class="form-row-2 mb-2">
      <view class="field-col">
        <view class="label-with-counter">
          <text class="form-label">本级名称</text>
          <text class="char-counter" :class="{ 'at-limit': (form.alias || '').length >= 50 }">{{ (form.alias || '').length }}/50</text>
        </view>
        <input class="field-input editable compact" :value="form.alias" placeholder="可选" :maxlength="50" @input="emit('update-field', 'alias', getInputValue($event))" />
      </view>
      <view class="field-col">
        <view class="label-with-counter">
          <text class="form-label">加价</text>
        </view>
        <view class="markup-input-group field-input editable compact">
          <input class="input-reset flex-1" type="number" :value="form.markup_value" @input="emit('update-field', 'markup_value', getInputValue($event))" />
          <view class="type-toggle-embedded">
            <AppButton type="primary" size="small" :round="false" class="type-toggle-action" :outline="form.markup_type !== 'FIXED'" @click="emit('update-field', 'markup_type', 'FIXED')">¥</AppButton>
            <AppButton type="primary" size="small" :round="false" class="type-toggle-action" :outline="form.markup_type !== 'PERCENT'" @click="emit('update-field', 'markup_type', 'PERCENT')">%</AppButton>
          </view>
        </view>
      </view>
    </view>

    <view class="mb-2">
      <view class="label-with-counter">
        <text class="form-label">说明 (公开)</text>
        <text class="char-counter" :class="{ 'at-limit': (form.instructions || '').length >= 2000 }">{{ (form.instructions || '').length }}/2000</text>
      </view>
      <textarea
        class="field-input editable compact multiline-2"
        :value="form.instructions"
        placeholder="如渠道/适用人群等"
        :auto-height="true"
        :maxlength="2000"
        @input="emit('update-field', 'instructions', getInputValue($event))"
      />
    </view>

    <view class="mb-2">
      <view class="label-with-counter">
        <text class="form-label">备注 (私密)</text>
        <text class="char-counter" :class="{ 'at-limit': (form.private_notes || '').length >= 2000 }">{{ (form.private_notes || '').length }}/2000</text>
      </view>
      <textarea
        class="field-input editable compact multiline-2"
        :value="form.private_notes"
        placeholder="可选"
        :auto-height="true"
        :maxlength="2000"
        @input="emit('update-field', 'private_notes', getInputValue($event))"
      />
    </view>

    <view v-if="preview" class="price-bar mt-2">
      <text class="text-highlight small">{{ mode === 'CREATE' ? '导入后售价' : '当前售价' }}: </text>
      <text class="price-display">¥{{ previewEditPrice }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';

defineProps<{
  mode: 'CREATE' | 'UPDATE';
  preview: any;
  form: any;
  previewEditPrice: string;
}>();

const emit = defineEmits<{
  (e: 'update-field', field: string, value: any): void;
}>();

const getInputValue = (event: any) => event?.detail?.value ?? '';
</script>

<style scoped lang="scss">
.flex-1 {
  flex: 1;
}

.form-label {
  font-size: 13px;
  color: $uni-text-color-grey;
  margin-bottom: 0;
  display: block;
  font-weight: 500;
}

.label-with-counter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.char-counter {
  font-size: 11px;
  color: $uni-text-color-grey;
  font-weight: normal;
}

.char-counter.at-limit {
  color: $uni-color-error;
}

.field-input {
  border-radius: $uni-radius-base;
  padding: 0 12px;
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  line-height: 40px;
  display: flex;
  align-items: center;
}

.field-input.readonly {
  background-color: $uni-bg-color-grey;
  border: 1px solid transparent;
  color: $uni-text-color-grey;
}

.field-input.editable {
  background-color: $uni-bg-color;
  border: 1px solid #cbd5e1;
  color: $uni-text-color;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.field-input.compact {
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}

.field-input.multiline-2 {
  min-height: 52px;
  height: auto;
  line-height: 1.5;
  padding: 6px 12px;
  display: block;
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.markup-input-group {
  padding: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.input-reset {
  border: none;
  background: transparent;
  height: 100%;
  padding: 0 12px;
  font-size: 14px;
  color: inherit;
  width: 100%;
}

.type-toggle-embedded {
  display: flex;
  border-left: 1px solid #cbd5e1;
  height: 100%;
}

.type-toggle-action {
  min-width: 44px;
  height: 100%;
}

.mb-2 {
  margin-bottom: 10px;
}

.mt-2 {
  margin-top: 8px;
}

.price-bar {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 6px;
}

.text-highlight {
  color: $uni-text-color-grey;
}

.small {
  font-size: 12px;
}

.price-display {
  font-size: 18px;
  font-weight: 700;
  color: $uni-color-error;
}
</style>
