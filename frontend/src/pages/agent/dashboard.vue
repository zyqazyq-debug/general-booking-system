<template>
  <AppPage title="分销看板" :with-navbar="true" :show-back="true" :padding="'16px'">
    <view class="agent-dashboard-page">
        <view class="row mb-4">
            <view class="col-6">
                <AppCard :padding="'16px'" class="stat-card">
                        <view class="stat-label">总回馈</view>
                        <text class="stat-value text-success">¥{{ stats.totalRevenue || 0 }}</text>
                </AppCard>
            </view>
            <view class="col-6">
                <AppCard :padding="'16px'" class="stat-card">
                        <view class="stat-label">分享预约</view>
                        <text class="stat-value text-primary">{{ stats.totalOrders || 0 }}</text>
                </AppCard>
            </view>
        </view>

        <AppCard title="回馈明细" :padding="'0'">
                <view v-if="!stats.orders || stats.orders.length === 0" class="empty-state">
                    <text class="empty-icon">💰</text>
                    <text class="empty-text">暂无回馈记录</text>
                </view>
                
                <view v-for="item in stats.orders" :key="item.orderId" class="list-item history-item">
                    <view class="left">
                        <h6 class="item-title">{{ item.serviceTitle || '未知服务' }}</h6>
                        <p class="item-meta">{{ formatDate(item.createdAt) }}</p>
                    </view>
                    <view class="right">
                        <text class="amount-plus">+¥{{ item.amount }}</text>
                        <span :class="['status-tag', item.status.toLowerCase()]">{{ formatStatus(item.status) }}</span>
                    </view>
                </view>
        </AppCard>
    </view>
  </AppPage>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { request } from '@/utils/request';
import dayjs from 'dayjs';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';

const stats = ref<any>({ totalOrders: 0, totalRevenue: 0, orders: [] });

const loadData = async () => {
  try {
    const res: any = await request({
      url: '/order/my',
      method: 'GET',
      params: { page: 1, limit: 200 },
    });
    const list = res?.data || res?.data?.data || [];
    const orders = Array.isArray(list) ? list : [];
    const agentOrders = orders.filter((o: any) =>
      Array.isArray(o?.roles) ? o.roles.includes('AGENT') : false,
    );
    const mapped = agentOrders
      .map((o: any) => {
        const amount = Number(o?.commission?.AGENT?.markup_amount ?? 0);
        return {
          orderId: o?.id,
          amount: Number.isFinite(amount) ? amount : 0,
          createdAt: o?.created_at,
          status: o?.status,
          serviceTitle: o?.service?.title || o?.service_snapshot?.title,
        };
      })
      .filter((o: any) => o?.orderId);
    const totalRevenue = mapped.reduce(
      (sum: number, o: any) => sum + Number(o.amount || 0),
      0,
    );
    stats.value = {
      totalOrders: mapped.length,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      orders: mapped,
    };
  } catch (e) {
    console.error(e);
  }
};

const formatDate = (d: string) => dayjs(d).format('MM-DD HH:mm');

const formatStatus = (status: string) => {
    const map: Record<string, string> = {
        'PENDING': '待入账',
        'COMPLETED': '已入账',
        'CANCELLED': '已取消'
    };
    return map[status] || status;
};

onMounted(() => {
  loadData();
});
</script>

<style lang="scss" scoped>
.agent-dashboard-page {
    width: 100%;
}
.stat-card {
    border: none;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
}
.stat-label {
    font-size: 13px;
    color: $uni-text-color-grey;
    margin-bottom: 6px;
}
.stat-value {
    font-size: 24px;
    font-weight: 700;
}

.history-item {
    padding: 16px;
    border-bottom: 1px solid $uni-bg-color-grey;
}
.item-title {
    font-size: 15px;
    color: $uni-text-color-secondary;
    margin-bottom: 4px;
}
.item-meta {
    font-size: 12px;
    color: $uni-text-color-placeholder;
}
.amount-plus {
    font-size: 16px;
    font-weight: 600;
    color: $uni-color-success;
    display: block;
    text-align: right;
}
.status-tag {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: $uni-radius-sm;
    margin-top: 4px;
    display: inline-block;
    float: right;
}
.status-tag.completed { background: #f0fdf4; color: $uni-color-success; }
.status-tag.pending { background: #fff7ed; color: #f97316; }
.status-tag.cancelled { background: #fef2f2; color: $uni-color-error; }
</style>
