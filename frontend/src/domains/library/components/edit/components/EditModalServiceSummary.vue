<template>
  <view>
    <view class="form-row-header mb-2">
      <view class="field-col flex-grow">
        <text class="form-label">上级名称</text>
        <input class="field-input readonly compact" :value="preview?.inherited_name || preview?.service?.title || ''" disabled />
      </view>
      <view class="field-col w-auto">
        <text class="form-label">时长</text>
        <input class="field-input readonly compact text-center" style="width: 70px" :value="(preview?.service?.duration_minutes || 60) + 'm'" disabled />
      </view>
      <view class="field-col w-auto">
        <text class="form-label">进价</text>
        <input class="field-input readonly compact text-center" style="width: 80px" :value="'¥' + costPrice" disabled />
      </view>
      <view class="field-col w-auto">
        <text class="form-label">信用点</text>
        <input class="field-input readonly compact text-center" style="width: 72px" :value="requiredCredit + '点'" disabled />
      </view>
    </view>

    <view class="info-grid mb-2">
      <view class="field-col">
        <text class="form-label">可预约日期</text>
        <input class="field-input readonly compact" :value="serviceDays" disabled />
      </view>
      <view class="field-col">
        <text class="form-label">可预约时间</text>
        <input class="field-input readonly compact" :value="serviceHours" disabled />
      </view>
    </view>

    <view v-if="preview?.service?.description" class="mb-2">
      <text class="form-label">原服务说明</text>
      <textarea
        class="readonly multiline-auto"
        :value="preview.service.description"
        disabled
        :auto-height="true"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { resolveCostPrice } from '@/shared/utils/price-compat';

const props = defineProps<{
  preview: any;
  serviceDays: string;
  serviceHours: string;
}>();

const costPrice = computed(() =>
  resolveCostPrice(
    props.preview?.service as Record<string, unknown>,
    'library_edit_summary_cost',
  ),
);

const requiredCredit = computed(() => {
  const value = Number(props.preview?.service?.deposit_points ?? 0);
  return Number.isFinite(value) ? value : 0;
});
</script>

<style scoped lang="scss">
.form-label {
  font-size: 13px;
  color: $uni-text-color-grey;
  margin-bottom: 6px;
  display: block;
  font-weight: 500;
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

.field-input.compact {
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}

.form-row-header {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.field-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.flex-grow {
  flex: 1;
  min-width: 0;
}

.w-auto {
  width: auto;
  flex: 0 0 auto;
}

.text-center {
  text-align: center;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.multiline-auto {
  width: 100%;
  box-sizing: border-box;
  border-radius: $uni-radius-base;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 12px;
  display: block;
}

.multiline-auto.readonly {
  background-color: $uni-bg-color-grey;
  border: 1px solid transparent;
  color: $uni-text-color-grey;
}

.mb-2 {
  margin-bottom: 10px;
}
</style>
