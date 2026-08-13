<template>
  <view>
    <view class="section-gap content-section-first">
      <text class="form-label">标题</text>
      <input v-model="form.title" class="service-input" placeholder="例如：钢琴课" />
    </view>

    <view class="grid-row-3 section-gap">
      <view class="field-col">
        <text class="form-label">价格</text>
        <input v-model="form.base_price" class="service-input text-center" type="number" placeholder="0" />
      </view>
      <view class="field-col">
        <text class="form-label">预定信用点</text>
        <input v-model="form.deposit_points" class="service-input text-center" type="number" placeholder="0" />
      </view>
      <view class="field-col">
        <text class="form-label">时长(分)</text>
        <input v-model="form.duration_minutes" class="service-input text-center" type="number" placeholder="60" />
      </view>
    </view>

    <view class="form-row-custom section-gap">
      <view class="field-col" style="flex: 1">
        <text class="form-label">缓冲(分)</text>
        <input v-model="form.buffer_minutes" class="service-input text-center" type="number" placeholder="0" />
      </view>
      <view class="field-col" style="flex: 1">
        <text class="form-label">开始预定(点)</text>
        <input v-model="rules.start_hour" class="service-input text-center" type="number" placeholder="9" />
      </view>
      <view class="field-col" style="flex: 1">
        <text class="form-label">结束预定(点)</text>
        <input v-model="rules.end_hour" class="service-input text-center" type="number" placeholder="17" />
      </view>
    </view>

    <view class="section-gap">
      <text class="form-label">重复周期</text>
      <view class="weekday-toggles toggle-gap-top">
        <view v-for="day in weekDaysList" :key="day.val" class="day-toggle" :class="{ active: rules.weekdays.includes(day.val) }" @click="emit('toggle-day', day.val)">
          {{ day.label }}
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  form: any;
  rules: any;
  weekDaysList: Array<{ val: number; label: string }>;
}>();

const emit = defineEmits<{
  (e: 'toggle-day', day: number): void;
}>();
</script>

<style scoped lang="scss">
.form-label {
  font-size: 13px;
  color: $uni-text-color-grey;
  margin-bottom: 6px;
  display: block;
  font-weight: 500;
}

.service-input {
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

.grid-row-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.form-row-custom {
  display: flex;
  gap: 8px;
}

.field-col {
  flex: 1;
  min-width: 0;
}

.text-center {
  text-align: center;
}

.weekday-toggles {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.day-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $uni-radius-circle;
  background-color: $uni-bg-color-grey;
  color: $uni-text-color-grey;
  font-size: 13px;
  border: 1px solid transparent;
}

.day-toggle.active {
  background-color: $uni-color-primary;
  color: $uni-bg-color;
  border-color: #2563eb;
  font-weight: 600;
  box-shadow: 0 4px 10px rgba(78, 151, 252, 0.35);
  transform: translateY(-1px);
}

.section-gap {
  margin-bottom: 10px;
}

.toggle-gap-top {
  margin-top: 8px;
}
</style>
