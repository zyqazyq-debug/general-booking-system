<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">代理看板</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <view class="row mb-4">
            <view class="col-6">
                <view class="card stat-card">
                    <view class="card-body">
                        <view class="stat-label">总收益</view>
                        <text class="stat-value text-success">¥{{ stats.totalRevenue || 0 }}</text>
                    </view>
                </view>
            </view>
            <view class="col-6">
                <view class="card stat-card">
                    <view class="card-body">
                        <view class="stat-label">推广订单</view>
                        <text class="stat-value text-primary">{{ stats.totalOrders || 0 }}</text>
                    </view>
                </view>
            </view>
        </view>

        <view class="card">
            <view class="card-header">
                <text class="card-title">收益明细</text>
            </view>
            <view class="card-body p-0">
                <view v-if="!stats.orders || stats.orders.length === 0" class="empty-state">
                    <text class="empty-icon">💰</text>
                    <text class="empty-text">暂无收益记录</text>
                </view>
                
                <view class="list-item history-item" v-for="item in stats.orders" :key="item.orderId">
                    <view class="left">
                        <h6 class="item-title">{{ item.scheduleTitle || '未知服务' }}</h6>
                        <p class="item-meta">{{ formatDate(item.createdAt) }}</p>
                    </view>
                    <view class="right">
                        <text class="amount-plus">+¥{{ item.amount }}</text>
                        <span :class="['status-tag', item.status.toLowerCase()]">{{ formatStatus(item.status) }}</span>
                    </view>
                </view>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { request } from '@/utils/request';
import dayjs from 'dayjs';

const stats = ref<any>({ totalOrders: 0, totalRevenue: 0, orders: [] });

const loadData = async () => {
  try {
    const res = await request({ url: '/agent/stats' });
    stats.value = res;
  } catch (e) {
    console.error(e);
  }
};

const formatDate = (d: string) => dayjs(d).format('MM-DD HH:mm');
const goBack = () => uni.navigateBack();

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

<style>
.stat-card {
    border: none;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
}
.stat-label {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 6px;
}
.stat-value {
    font-size: 24px;
    font-weight: 700;
}

.history-item {
    padding: 16px;
    border-bottom: 1px solid #f1f5f9;
}
.item-title {
    font-size: 15px;
    color: #334155;
    margin-bottom: 4px;
}
.item-meta {
    font-size: 12px;
    color: #94a3b8;
}
.amount-plus {
    font-size: 16px;
    font-weight: 600;
    color: #28a745;
    display: block;
    text-align: right;
}
.status-tag {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-top: 4px;
    display: inline-block;
    float: right;
}
.status-tag.completed { background: #f0fdf4; color: #28a745; }
.status-tag.pending { background: #fff7ed; color: #f97316; }
.status-tag.cancelled { background: #fef2f2; color: #ef4444; }
</style>
