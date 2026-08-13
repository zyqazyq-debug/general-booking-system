<template>
  <AppCard
    :padding="'12px'"
    :no-margin="true"
    :shadow="false"
    class="order-card-item"
    @click="emit('detail', item)"
  >
    <view class="order-header">
      <view class="info-col">
        <h6 class="service-name">
          {{
            item.service?.title ||
              item.service_snapshot?.title ||
              '未知服务'
          }}
        </h6>
        <text v-if="item.order_no" class="order-no">单号：{{ item.order_no }}</text>
        <text class="time-range">{{ formatTimeRange(item.start_time, item.end_time) }}</text>
      </view>
      <view class="status-col">
        <span :class="['status-badge', getStatusClass(item.status)]">{{ formatStatus(item.status) }}</span>
      </view>
    </view>

    <view class="divider"></view>

    <view
      v-if="currentTab !== 'CONSUMER' && item.commission && item.commission[currentTab]"
      class="role-details role-details-gap"
    >
      <view v-if="currentTab === 'PROVIDER'" class="detail-row">
        <text class="detail-label">基础售价:</text>
        <text class="detail-value">¥{{ formatMoney(item.commission['PROVIDER'].markup_amount) }}</text>
      </view>
      <view v-if="currentTab === 'AGENT'" class="detail-col">
        <view class="detail-row" style="justify-content: space-between;">
          <text class="detail-value compact-text">
            ¥{{ formatMoney(item.commission['AGENT'].cost_price) }}(进) +
            <text class="value-profit">¥{{ formatMoney(item.commission['AGENT'].markup_amount) }}(赚)</text> =
            <text class="value-sale">¥{{ formatMoney(item.commission['AGENT'].final_price) }}(售)</text>
          </text>
        </view>
      </view>
    </view>

    <view class="order-footer">
      <view v-if="currentTab !== 'AGENT'" class="price-info">
        <text class="label">订单金额</text>
        <view class="value-row">
          <text v-if="currentTab === 'CONSUMER'" class="value">¥{{ formatMoney(item.display_price_snapshot) }}</text>
          <text v-else class="value">¥{{ formatMoney(item.commission?.['PROVIDER']?.final_price ?? item.service_snapshot?.base_price ?? item.display_price_snapshot) }}</text>
        </view>
      </view>
      <view v-else class="price-info"></view>

      <view v-if="canCancel(item)" class="actions">
        <AppButton type="error" outline size="small" class="action-button" @click.stop="emit('cancel', item)">取消</AppButton>
        <AppButton v-if="canConsumerComplete(item)" type="primary" size="small" class="action-button" @click.stop="emit('complete', item)">确认完成</AppButton>
      </view>
      <view v-else-if="currentTab === 'PROVIDER'" class="actions">
        <template v-if="scene === 'provider-manage'">
          <AppButton v-if="canProviderConfirm(item)" type="primary" size="small" class="action-button" @click.stop="emit('provider-confirm', item)">确认预约</AppButton>
          <AppButton
            v-if="canComplete(item)"
            type="primary"
            size="small"
            class="action-button"
            :disabled="!canProviderComplete(item)"
            @click.stop="emit('complete', item)"
          >
            完成服务
          </AppButton>
          <AppButton v-if="canProviderNoShow(item)" type="error" outline size="small" class="action-button" @click.stop="emit('provider-no-show', item)">标记违约</AppButton>
        </template>
        <template v-else>
          <AppButton v-if="canProviderDelete(item)" type="info" outline size="small" class="action-button" @click.stop="emit('hide', item)">删除</AppButton>
          <AppButton v-if="canProviderCancel(item)" type="error" outline size="small" class="action-button" @click.stop="emit('provider-cancel', item)">取消</AppButton>
          <AppButton
            v-if="canComplete(item)"
            type="primary"
            size="small"
            class="action-button"
            :disabled="!canProviderComplete(item)"
            @click.stop="emit('complete', item)"
          >
            完成
          </AppButton>
        </template>
      </view>
    </view>
  </AppCard>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import { useOrderListUiContext } from './composables/useOrderListUiContext';

const formatMoney = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(2).replace(/\.00$/, '');
};

const {
  currentTab,
  scene,
  formatStatus,
  getStatusClass,
  formatTimeRange,
  canCancel,
  canConsumerComplete,
  canProviderDelete,
  canProviderCancel,
  canProviderConfirm,
  canProviderNoShow,
  canComplete,
  canProviderComplete,
} = useOrderListUiContext();

defineProps<{
  item: any;
}>();

const emit = defineEmits<{
  (e: 'detail', item: any): void;
  (e: 'cancel', item: any): void;
  (e: 'provider-confirm', item: any): void;
  (e: 'complete', item: any): void;
  (e: 'hide', item: any): void;
  (e: 'provider-cancel', item: any): void;
  (e: 'provider-no-show', item: any): void;
}>();
</script>

<style lang="scss" scoped>
.order-header {
  display: flex;
  align-items: center;
}
.info-col {
  flex: 1;
  overflow: hidden;
}
.service-name {
  font-size: 16px;
  font-weight: 600;
  color: $uni-text-color;
  margin-bottom: 4px;
}
.order-no {
  font-size: 12px;
  color: $uni-text-color-placeholder;
  display: block;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time-range {
  font-size: 13px;
  color: $uni-text-color-grey;
}
.status-badge {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}
.status-pending {
  background-color: #fff7ed;
  color: #f97316;
}
.status-reserved {
  background-color: $uni-color-primary-light;
  color: $uni-color-primary;
}
.status-completed {
  background-color: #f0fdf4;
  color: $uni-color-success;
}
.status-danger {
  background-color: #fef2f2;
  color: $uni-color-error;
}
.status-warning {
  background-color: #fefce8;
  color: #eab308;
}
.status-gray {
  background-color: $uni-bg-color-grey;
  color: $uni-text-color-grey;
}
.divider {
  height: 1px;
  background-color: $uni-bg-color-grey;
  margin: 12px 0;
}
.role-details {
  background-color: $uni-bg-color-hover;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.detail-row {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: $uni-text-color-grey;
}
.detail-col {
  display: flex;
  flex-direction: column;
}
.value-profit {
  color: $uni-color-success;
}
.value-sale {
  color: $uni-color-primary;
}
.compact-text {
  font-size: 13px;
}
.role-details-gap {
  margin-bottom: 8px;
}
.order-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.price-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.price-info .label {
  font-size: 12px;
  color: $uni-text-color-placeholder;
  margin-bottom: 2px;
  margin-right: 0;
}
.price-info .value {
  font-size: 18px;
  font-weight: 700;
  color: $uni-text-color;
  line-height: 1.2;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.actions .action-button {
  margin: 0;
  min-width: 60px;
  justify-content: center;
}
</style>
