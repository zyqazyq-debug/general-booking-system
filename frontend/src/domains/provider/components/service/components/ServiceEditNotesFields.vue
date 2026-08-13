<template>
  <view>
    <view class="divider my-3"></view>

    <view class="mb-3">
      <view class="label-with-counter">
        <text class="form-label">说明</text>
        <text class="char-counter" :class="{ 'at-limit': (form.description || '').length >= 200 }">{{ (form.description || '').length }}/200</text>
      </view>
      <textarea v-model="form.description" class="notes-input textarea-sm" placeholder="导入服务时可传递的说明" :auto-height="false" :maxlength="200" />
    </view>

    <view class="mb-3">
      <view class="label-with-counter">
        <text class="form-label">备注 (私密)</text>
        <text class="char-counter" :class="{ 'at-limit': (form.original_notes || '').length >= 500 }">{{ (form.original_notes || '').length }}/500</text>
      </view>
      <textarea v-model="form.original_notes" class="notes-input textarea-sm" placeholder="仅自己可见" :auto-height="false" :maxlength="500" />
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  form: any;
}>();
</script>

<style scoped lang="scss">
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

.notes-input {
  background-color: $uni-bg-color;
  border: 1px solid #cbd5e1;
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

.textarea-sm {
  min-height: 44px;
  line-height: 1.5;
  padding: 6px 12px;
  height: auto;
}

.divider {
  height: 1px;
  background-color: $uni-bg-color-grey;
  width: 100%;
}

.my-3 {
  margin: 10px 0;
}

.mb-3 {
  margin-bottom: 10px;
}
</style>
