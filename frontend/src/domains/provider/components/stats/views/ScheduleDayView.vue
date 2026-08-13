<template>
  <view class="day-view-container">
    <view class="day-grid">
      <view v-for="slot in dayTimeSlots" :key="slot.idx" class="day-cell" :class="getSlotClass(slot.idx)" @click="emit('slot-click', slot.idx)">
        <text class="time-label-mini">{{ slot.label }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  dayTimeSlots: Array<{ idx: number; label: string }>;
  getSlotClass: (slotIdx: number) => string;
}>();

const emit = defineEmits<{
  (e: 'slot-click', slotIdx: number): void;
}>();
</script>

<style scoped>
.day-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.day-cell {
  background-color: #f8fafc;
  border-radius: 8px;
  padding: 8px;
  text-align: center;
  border: 1px solid #e2e8f0;
}

.day-cell.slot-start-order {
  background-color: #bfdbfe;
  border-color: #60a5fa;
  color: #1e3a8a;
}

.day-cell.slot-occupied {
  background-color: #eff6ff;
  border-color: #dbeafe;
  color: #60a5fa;
}

.day-cell.has-order {
  background-color: #e0f2fe;
  border-color: #bae6fd;
}

.time-label-mini {
  font-size: 12px;
  color: #64748b;
  display: block;
}
</style>
