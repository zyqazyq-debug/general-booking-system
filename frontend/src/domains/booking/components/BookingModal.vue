<template>
  <AppModal
    :visible="visible"
    :title="service?.title || '预约服务'"
    variant="workspace"
    :center-title="true"
    :scrollable="false"
    :show-scroll-hint="false"
    body-padding="0"
    @close="close"
  >
    <scroll-view v-if="service" scroll-y class="modal-scroll-body">
      <view class="scroll-inner">
        <view class="service-info-section">
          <view class="title-row">
            <view class="price-duration-row">
              <text class="price-tag">¥{{ displayPrice }}</text>
              <text class="duration-text">/ {{ service.duration_minutes }}分钟</text>
              <text v-if="service.deposit_points > 0" class="deposit-tag">定金: {{ service.deposit_points }}</text>
            </view>
          </view>
          <view class="meta-row mt-1">
            <text class="meta-item">{{ weekdayRuleText }}</text>
            <text class="meta-divider">|</text>
            <text class="meta-item">{{ timeRuleText }}</text>
          </view>
          <view v-if="hasPublicDescription" class="public-desc-card">
            <view class="public-desc-header">
              <text class="public-desc-title">本级公开说明</text>
              <text
                v-if="isDescriptionOverflow || descriptionExpanded"
                class="public-desc-action"
                @click="toggleDescriptionExpanded"
              >
                {{ descriptionExpanded ? '收起' : '展开' }}
              </text>
            </view>
            <text
              class="public-desc-text"
              :class="{ 'public-desc-text--collapsed': !descriptionExpanded }"
            >
              {{ service.description }}
            </text>
          </view>
          <view
            v-if="service.location && (service.location.name || service.location.address)"
            class="location-row mt-2"
            @click="openLocation"
          >
            <text class="icon-location">📍</text>
            <text class="location-text text-truncate">{{ service.location.name || service.location.address }}</text>
            <text class="icon-arrow small text-muted">></text>
          </view>
        </view>

        <view v-if="loadErrorMessage" class="top-error-banner">
          <text class="top-error-text">{{ loadErrorMessage }}</text>
        </view>

        <BookingDateNavigator
          :selected-date="selectedDate"
          :today="today"
          :max-date="maxDate"
          :day-of-week-text="dayOfWeekText"
          @prev="prevDay"
          @next="nextDay"
          @change="onDateChange"
        />

        <BookingSlotGrid
          :selected-date="selectedDate"
          :loading-slots="loadingSlots"
          :is-service-offline="isServiceOffline"
          :slots="slots"
          :selected-slot="selectedSlot"
          :is-slot-in-duration="isSlotInDuration"
          :format-time="formatTime"
          @select-slot="selectSlot"
        />
      </view>
    </scroll-view>
    <view v-else class="loading-state">
      <text v-if="loadErrorMessage" class="loading-error">{{ loadErrorMessage }}</text>
      <text v-else>加载中...</text>
    </view>

    <template v-if="service" #footer>
      <BookingFooterActions
        :show-credit-line="!!userStore.userInfo"
        :available-credit="availableCredit"
        :required-credit="requiredCredit"
        :credit-shortfall="creditShortfall"
        :need-purchase-credit="needPurchaseCredit"
        :show-collection-action="showCollectionAction"
        @add-to-collection="addToCollection"
        @primary-action="handlePrimaryAction"
      />
    </template>
  </AppModal>

  <BookingConfirmDialog
    :visible="showConfirmDialog"
    :content="confirmContent"
    @cancel="closeConfirmDialog"
    @confirm="executeBooking"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import BookingConfirmDialog from './BookingConfirmDialog.vue';
import BookingDateNavigator from './BookingDateNavigator.vue';
import BookingSlotGrid from './BookingSlotGrid.vue';
import BookingFooterActions from './BookingFooterActions.vue';
import { useBookingCore } from '../composables/useBookingCore';
import { useBookingInteractions } from '../composables/useBookingInteractions';

const emit = defineEmits(['close', 'success']);
const {
  userStore,
  visible,
  service,
  displayPrice,
  showCollectionAction,
  selectedDate,
  slots,
  selectedSlot,
  loadingSlots,
  isServiceOffline,
  loadErrorMessage,
  today,
  maxDate,
  weekdayRuleText,
  dayOfWeekText,
  timeRuleText,
  requiredCredit,
  availableCredit,
  creditShortfall,
  needPurchaseCredit,
  showConfirmDialog,
  confirmContent,
  open,
  close,
  onDateChange,
  prevDay,
  nextDay,
  selectSlot,
  isSlotInDuration,
  formatTime,
  addToCollection,
  handlePrimaryAction,
  executeBooking,
  closeConfirmDialog,
} = useBookingCore(
  () => emit('close'),
  () => emit('success'),
);

const { openLocation } = useBookingInteractions(service);
const descriptionExpanded = ref(false);
const hasPublicDescription = computed(() => {
  const value = service.value?.description;
  return typeof value === 'string' && value.trim().length > 0;
});
const isDescriptionOverflow = computed(() => {
  const value = service.value?.description;
  return typeof value === 'string' && value.trim().length > 100;
});
const toggleDescriptionExpanded = () => {
  descriptionExpanded.value = !descriptionExpanded.value;
};
watch(
  () => service.value?.id,
  () => {
    descriptionExpanded.value = false;
  },
);

defineExpose({ open, close });
</script>

<style lang="scss" scoped>
.modal-scroll-body {
  height: 100%;
  box-sizing: border-box;
  min-height: 0;
}

.scroll-inner {
  padding: 16px;
}

.service-info-section {
  margin-bottom: 12px;
}

.title-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.price-duration-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: nowrap;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.price-tag,
.duration-text,
.deposit-tag {
  display: inline-block;
  flex-shrink: 0;
  white-space: nowrap;
}

.duration-text {
  font-size: 14px;
  color: $uni-text-color-grey;
  font-weight: 500;
}

.price-tag {
  font-size: 20px;
  font-weight: 800;
  color: #2563eb;
  flex-shrink: 0;
  line-height: 1.2;
}

.deposit-tag {
  font-size: 12px;
  color: #eab308;
  background-color: #fefce8;
  padding: 2px 6px;
  border-radius: $uni-radius-sm;
  margin-left: 8px;
  border: 1px solid #fef08a;
}

.meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  justify-content: flex-end;
  width: 100%;
}

.meta-item {
  font-size: 13px;
  color: $uni-text-color-grey;
  display: flex;
  align-items: center;
  line-height: 1;
}

.meta-divider {
  font-size: 10px;
  color: #cbd5e1;
}

.location-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: $uni-bg-color-hover;
  padding: 10px 12px;
  border-radius: $uni-radius-base;
  cursor: pointer;
  margin-top: 12px;
}

.public-desc-card {
  margin-top: 10px;
  padding: 10px 12px;
  background-color: $uni-bg-color-hover;
  border-radius: $uni-radius-base;
}

.public-desc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.public-desc-title {
  font-size: 13px;
  color: $uni-text-color;
  font-weight: 600;
}

.public-desc-action {
  font-size: 12px;
  color: $uni-color-primary;
}

.public-desc-text {
  font-size: 13px;
  color: $uni-text-color-secondary;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.public-desc-text--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.icon-location {
  font-size: 16px;
  flex-shrink: 0;
}

.location-text {
  flex: 1;
  font-size: 14px;
  color: $uni-text-color-secondary;
  font-weight: 500;
}

.icon-arrow {
  flex-shrink: 0;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: $uni-text-color-placeholder;
  font-size: 14px;
}
.loading-error {
  color: #ef4444;
  padding: 0 16px;
  text-align: center;
}

.top-error-banner {
  margin-top: 8px;
  padding: 8px 12px;
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: $uni-radius-base;
}
.top-error-text {
  color: #ef4444;
  font-size: 13px;
}

.small {
  font-size: 12px;
}

.text-muted {
  color: $uni-text-color-grey;
}

.text-truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mt-1 {
  margin-top: 4px;
}

.mt-2 {
  margin-top: 8px;
}
</style>
