<template>
  <view class="order-detail-comp">
    <AppCard title="基本信息">
      <view class="detail-item">
          <text class="label">服务名称</text>
          <text class="value">{{ order.service?.title || '未知服务' }}</text>
      </view>
      <view class="detail-item">
          <text class="label">订单号</text>
          <text class="value">{{ order.order_no }}</text>
      </view>
      <view class="detail-item">
          <text class="label">当前状态</text>
          <text class="value highlight">{{ formatStatus(order.status) }}</text>
      </view>
      <view v-if="order.status === 'CANCELLED' && getCancelActorLabel(order) !== '-'" class="detail-item">
          <text class="label">取消发起方</text>
          <text class="value">{{ getCancelActorLabel(order) }}</text>
      </view>
      <view v-if="order.status === 'CANCELLED' && order.metadata?.cancelled_at" class="detail-item">
          <text class="label">取消时间</text>
          <text class="value">{{ formatTime(order.metadata.cancelled_at) }}</text>
      </view>
      <view v-if="order.status === 'CANCELLED' && order.metadata?.cancellation_reason" class="detail-item">
          <text class="label">取消原因</text>
          <text class="value">{{ order.metadata.cancellation_reason }}</text>
      </view>
      <view class="detail-item">
          <text class="label">订单类别</text>
          <text class="value">{{ getOrderTypeLabel(role, !!order.agency_node) }}</text>
      </view>
      <view class="detail-item">
          <text class="label">下单时间</text>
          <text class="value">{{ formatTime(order.created_at) }}</text>
      </view>
    </AppCard>

    <AppCard v-if="role && contextInfo" title="链路信息">
      <view v-if="['AGENT', 'CONSUMER'].includes(role) && contextInfo.upstream" class="detail-item">
          <text class="label">上级来源</text>
          <text class="value">
              {{ contextInfo.upstream.role === 'PROVIDER' ? '服务商' : '代理' }} 
              {{ contextInfo.upstream.nickname }}
          </text>
      </view>
      <view v-if="['AGENT', 'PROVIDER'].includes(role) && contextInfo.downstream" class="detail-item">
          <text class="label">下级去向</text>
          <text class="value">
              {{ contextInfo.downstream.role === 'CONSUMER' ? '消费者' : '代理' }}
              {{ contextInfo.downstream.nickname }}
          </text>
      </view>
    </AppCard>

    <AppCard v-if="role === 'AGENT' && commission" title="分润详情">
      <view class="detail-item">
          <text class="label">进货价</text>
          <text class="value">¥{{ commission.cost_price }}</text>
      </view>
      <view class="detail-item">
          <text class="label">加价利润</text>
          <text class="value text-success">+¥{{ commission.markup_amount }}</text>
      </view>
      <view class="detail-item">
          <text class="label">最终售价</text>
          <text class="value text-primary">¥{{ commission.final_price }}</text>
      </view>
    </AppCard>

    <AppCard title="服务详情">
      <view class="detail-item">
          <text class="label">服务时间</text>
          <text class="value">{{ formatTimeRange(order.start_time, order.end_time) }}</text>
      </view>
      <view class="detail-item">
          <text class="label">服务时长</text>
          <text class="value">{{ getDuration(order.start_time, order.end_time) }}</text>
      </view>
      <view v-if="order.metadata && order.metadata.remark" class="detail-item">
          <text class="label">下单备注</text>
          <text class="value">{{ order.metadata.remark }}</text>
      </view>
      <view v-if="commission && commission.snapshot_markup_type" class="detail-item">
          <text class="label">加价说明</text>
          <text v-if="commission.snapshot_markup_type === 'FIXED'" class="value">固定加价 ¥{{ commission.snapshot_markup_value }}</text>
          <text v-else class="value">百分比加价 {{ commission.snapshot_markup_value }}%</text>
      </view>
    </AppCard>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { getOrderDetail } from '../api/order';
import AppCard from '@/components/AppCard.vue';
import { useOrderDisplay } from '../composables/useOrderDisplay';

interface Props {
    orderId?: string;
    role?: string;
}

const props = withDefaults(defineProps<Props>(), {
    orderId: '',
    role: 'CONSUMER'
});

const order = ref<any>({});
const role = ref(props.role);
const commission = ref<any>(null);
const contextInfo = ref<any>(null);
const { formatStatus, formatTime, formatTimeRange, getDuration, getCancelActorLabel, getOrderTypeLabel } = useOrderDisplay();

const loadDetail = async (id: string) => {
    if (!id) return;
    try {
        const res: any = await getOrderDetail(id);
        order.value = res;
        if (res.context_role) role.value = res.context_role;
        if (res.context_info) {
            contextInfo.value = res.context_info;
            if (res.context_info.commission) commission.value = res.context_info.commission;
        }
    } catch (e) {
        console.error('[orderDetail]', e);
    }
};

watch(() => props.orderId, (newId) => loadDetail(newId));
onMounted(() => loadDetail(props.orderId));
</script>

<style lang="scss" scoped>
.detail-item { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
.detail-item:last-child { margin-bottom: 0; }
.label { color: $uni-text-color-grey; }
.value { color: $uni-text-color-secondary; font-weight: 500; text-align: right; max-width: 70%; }
.highlight { color: $uni-color-primary; font-weight: 600; }
.text-success { color: $uni-color-success; }
.text-primary { color: $uni-color-primary; }
</style>
