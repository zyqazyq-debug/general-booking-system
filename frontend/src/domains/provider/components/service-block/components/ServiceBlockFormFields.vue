<template>
  <view>
    <view class="form-row">
      <view class="field-col">
        <view class="form-group">
          <text class="form-label">开始日期</text>
          <view class="picker-box">
            <picker mode="date" :value="form.start_date" @change="emit('start-date-change', $event)">
              <view class="picker-value">{{ form.start_date || '请选择开始日期' }}</view>
            </picker>
          </view>
        </view>
      </view>
      <view class="field-col">
        <view class="form-group">
          <text class="form-label">开始时间</text>
          <view class="picker-box">
            <picker mode="time" :value="form.start_clock" @change="emit('start-clock-change', $event)">
              <view class="picker-value">{{ form.start_clock || '请选择开始时间' }}</view>
            </picker>
          </view>
        </view>
      </view>
    </view>

    <view class="form-row">
      <view class="field-col">
        <view class="form-group">
          <text class="form-label">结束日期</text>
          <view class="picker-box">
            <picker mode="date" :value="form.end_date" @change="emit('end-date-change', $event)">
              <view class="picker-value">{{ form.end_date || '请选择结束日期' }}</view>
            </picker>
          </view>
        </view>
      </view>
      <view class="field-col">
        <view class="form-group">
          <text class="form-label">结束时间</text>
          <view class="picker-box">
            <picker mode="time" :value="form.end_clock" @change="emit('end-clock-change', $event)">
              <view class="picker-value">{{ form.end_clock || '请选择结束时间' }}</view>
            </picker>
          </view>
        </view>
      </view>
    </view>

    <view class="form-group">
      <text class="form-label">休息原因 (选填)</text>
      <input v-model="form.reason" class="block-input" placeholder="例如：外出办事、设备维护" />
    </view>

    <view class="modal-footer">
      <AppButton type="info" :outline="true" size="medium" style="margin-right: 12px; flex: 1" @click="emit('cancel')">取消</AppButton>
      <AppButton type="primary" size="medium" :loading="loading" style="flex: 1" @click="emit('submit')">增加休息</AppButton>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/shared/components/AppButton.vue';

defineProps<{
  form: any;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'start-date-change', event: any): void;
  (e: 'start-clock-change', event: any): void;
  (e: 'end-date-change', event: any): void;
  (e: 'end-clock-change', event: any): void;
  (e: 'cancel'): void;
  (e: 'submit'): void;
}>();
</script>

<style scoped lang="scss">
.form-group {
  margin-bottom: $uni-spacing-base;
}

.form-row {
  display: flex;
  gap: 12px;
}

.field-col {
  flex: 1;
  min-width: 0;
}

.form-label {
  font-size: $uni-font-size-sm;
  color: $uni-text-color-grey;
  margin-bottom: 6px;
  display: block;
  font-weight: 500;
}

.block-input {
  width: 100%;
  height: 40px;
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
  font-size: $uni-font-size-body;
  color: $uni-text-color;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.picker-box {
  border: 1px solid $uni-border-color;
  border-radius: $uni-radius-base;
  padding: 0 12px;
}

.picker-value {
  min-height: 40px;
  line-height: 40px;
  font-size: $uni-font-size-body;
  color: $uni-text-color;
}

.modal-footer {
  padding: $uni-spacing-base;
  border-top: 1px solid $uni-border-color-light;
  display: flex;
  justify-content: flex-end;
  background-color: $uni-bg-color;
}
</style>
