<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">订单管理</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <view class="order-list">
            <view v-if="list.length === 0" class="empty-state">
                <text class="empty-icon">📝</text>
                <text class="empty-text">暂无待处理订单</text>
            </view>

            <view class="card order-card" v-for="item in list" :key="item.id">
                <view class="card-body">
                    <view class="order-header">
                        <view class="info-col">
                            <h6 class="service-name">{{ item.schedule?.title }}</h6>
                            <view class="customer-info">
                                <text class="icon">👤</text>
                                <text>{{ item.consumer?.username }}</text>
                            </view>
                        </view>
                        <view class="status-col">
                            <span :class="['status-badge', getStatusClass(item.status)]">{{ formatStatus(item.status) }}</span>
                        </view>
                    </view>

                    <view class="time-block">
                        <text class="time-text">{{ formatDate(item.start_time) }} - {{ formatDate(item.end_time) }}</text>
                    </view>
                    
                    <view class="divider"></view>
                    
                    <view class="action-footer">
                        <template v-if="item.status === 'PENDING'">
                            <button class="btn btn-sm btn-primary action-btn full-width" @click="doAction(item.id, 'confirm')">确认预约</button>
                        </template>
                        
                        <template v-if="item.status === 'RESERVED'">
                            <button class="btn btn-sm btn-success action-btn" @click="doAction(item.id, 'complete')">完成服务</button>
                            <button class="btn btn-sm btn-outline-danger action-btn" @click="doAction(item.id, 'no-show')">标记违约</button>
                        </template>
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

const list = ref<any[]>([]);

const loadData = async () => {
  try {
    const res = await request({ url: '/order/manage' });
    list.value = res as any[];
  } catch (e) {
    console.error(e);
  }
};

const formatDate = (d: string) => dayjs(d).format('MM-DD HH:mm');
const goBack = () => uni.navigateBack();

const getStatusClass = (status: string) => {
    switch(status) {
        case 'PENDING': return 'status-pending';
        case 'RESERVED': return 'status-reserved';
        case 'COMPLETED': return 'status-completed';
        case 'FORFEITED': return 'status-danger';
        case 'DISPUTED': return 'status-warning';
        case 'CANCELLED': return 'status-gray';
        default: return 'status-gray';
    }
};

const formatStatus = (status: string) => {
    const map: Record<string, string> = {
        'PENDING': '待确认',
        'RESERVED': '已预约',
        'COMPLETED': '已完成',
        'FORFEITED': '已违约',
        'DISPUTED': '争议中',
        'CANCELLED': '已取消'
    };
    return map[status] || status;
};

const doAction = async (id: string, action: string) => {
    try {
        let url = `/order/${id}/${action}`;
        if (action === 'no-show') {
             // Backend maps no-show to forfeit logic, or we can use forfeit if exposed
             // Backend controller has :id/no-show
        }
        await request({
            url,
            method: 'POST'
        });
        uni.showToast({ title: '操作成功', icon: 'success' });
        loadData();
    } catch (e) {
        console.error(e);
    }
};

onMounted(() => {
  loadData();
});
</script>

<style>
.order-card {
    border: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    border-radius: 12px;
}

.order-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
}

.service-name {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 4px;
}

.customer-info {
    display: flex;
    align-items: center;
    font-size: 13px;
    color: #64748b;
}
.customer-info .icon { margin-right: 4px; }

.status-badge {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
}
.status-pending { background-color: #fff7ed; color: #f97316; }
.status-reserved { background-color: #eff6ff; color: #4e97fc; }
.status-completed { background-color: #f0fdf4; color: #28a745; }
.status-danger { background-color: #fef2f2; color: #ef4444; }
.status-warning { background-color: #fefce8; color: #eab308; }
.status-gray { background-color: #f1f5f9; color: #64748b; }

.time-block {
    background-color: #f8fafc;
    padding: 8px 12px;
    border-radius: 8px;
    margin-bottom: 12px;
}
.time-text {
    font-size: 13px;
    color: #334155;
    font-family: monospace;
}

.divider {
    height: 1px;
    background-color: #f1f5f9;
    margin: 12px 0;
}

.action-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.action-btn {
    min-width: 80px;
    height: 36px;
    font-size: 13px;
    margin: 0;
}
.full-width { width: 100%; }

.btn-success {
    background-color: #28a745;
    color: #fff;
    border-color: #28a745;
}
.btn-outline-danger { 
    background: transparent; 
    border: 1px solid #ef4444; 
    color: #ef4444; 
    box-shadow: none;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #94a3b8;
}
.empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
.empty-text { font-size: 14px; }
</style>
