<template>
  <view v-if="selectedDate" class="slots-section mt-2">
    <text class="section-label mb-2 d-block small text-muted">选择开始时间</text>

    <view v-if="loadingSlots" class="status-msg py-3">
      <text>加载中...</text>
    </view>

    <view v-else-if="isServiceOffline" class="status-msg py-3 offline-msg">
      <text>⛔ 该服务已下架，暂无法预约</text>
    </view>

    <view v-else-if="slots.length === 0" class="status-msg py-3">
      <text>该日期暂无可用时段</text>
    </view>

    <view v-else class="slot-grid">
      <view
        v-for="slot in slots"
        :key="slot.start_time"
        class="slot-item"
        :class="{
          selected: selectedSlot?.start_time === slot.start_time,
          booked: slot.status !== 'available',
          'duration-highlight': isSlotInDuration(slot),
        }"
        @click="slot.status === 'available' && emit('select-slot', slot)"
      >
        {{ formatTime(slot.start_time) }}
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  selectedDate: string;
  loadingSlots: boolean;
  isServiceOffline: boolean;
  slots: any[];
  selectedSlot: any;
  isSlotInDuration: (slot: any) => boolean;
  formatTime: (iso: string) => string;
}>();

const emit = defineEmits<{
  (e: 'select-slot', slot: any): void;
}>();
</script>

<style scoped>
.slots-section {
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}
.section-label {
  font-size: 13px;
  color: #94a3b8;
  margin-bottom: 8px;
  display: block;
}
.status-msg {
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
  padding: 20px 0;
}
.offline-msg {
  color: #ef4444;
  background-color: #fef2f2;
  border-radius: 8px;
  margin-top: 8px;
}
.slot-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.slot-item {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  color: #334155;
  transition: all 0.2s;
}
.slot-item.selected {
  background-color: #2563eb;
  color: #fff;
  border-color: #2563eb;
  font-weight: 600;
}
.slot-item.duration-highlight {
  background-color: #dbeafe;
  color: #1e40af;
  border-color: #bfdbfe;
}
.slot-item.booked {
  background-color: #f1f5f9;
  color: #cbd5e1;
  border-color: #f1f5f9;
  text-decoration: line-through;
  cursor: not-allowed;
}
.d-block {
  display: block;
}
.small {
  font-size: 12px;
}
.text-muted {
  color: #64748b;
}
.mb-2 {
  margin-bottom: 8px;
}
.mt-2 {
  margin-top: 8px;
}
.py-3 {
  padding-top: 12px;
  padding-bottom: 12px;
}
</style>
