<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">{{ hideTabs ? getTabName() : '我的订单' }}</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <view class="tabs-container" v-if="!hideTabs">
            <view class="tab-item" :class="{ active: currentTab === 'CONSUMER' }" @click="switchTab('CONSUMER')">
                <text>消费订单</text>
                <view class="tab-line" v-if="currentTab === 'CONSUMER'"></view>
            </view>
            <view class="tab-item" :class="{ active: currentTab === 'PROVIDER' }" @click="switchTab('PROVIDER')">
                <text>服务订单</text>
                <view class="tab-line" v-if="currentTab === 'PROVIDER'"></view>
            </view>
            <view class="tab-item" :class="{ active: currentTab === 'AGENT' }" @click="switchTab('AGENT')">
                <text>代理订单</text>
                <view class="tab-line" v-if="currentTab === 'AGENT'"></view>
            </view>
        </view>

        <view class="order-list">
            <view v-if="filteredList.length === 0" class="empty-state">
                <text class="empty-icon">💰</text>
                <text class="empty-text">暂无{{ getTabName() }}</text>
            </view>

            <view class="card order-card" v-for="item in filteredList" :key="item.id">
                <view class="card-body">
                    <view class="order-header">
                        <view class="date-box">
                            <text class="day">{{ getDay(item.start_time) }}</text>
                            <text class="month">{{ getMonth(item.start_time) }}</text>
                        </view>
                        <view class="info-col">
                            <h6 class="service-name">{{ item.schedule?.title || '未知服务' }}</h6>
                            <text class="order-no" v-if="item.order_no">单号：{{ item.order_no }}</text>
                            <text class="time-range">{{ getTime(item.start_time) }} - {{ getTime(item.end_time) }}</text>
                        </view>
                        <view class="status-col">
                            <span :class="['status-badge', getStatusClass(item.status)]">{{ formatStatus(item.status) }}</span>
                        </view>
                    </view>
                    
                    <view class="divider"></view>
                    
                    <!-- Commission/Role Specific Details -->
                    <view class="role-details mb-2" v-if="currentTab !== 'CONSUMER' && item.commission && item.commission[currentTab]">
                        <view class="detail-row" v-if="currentTab === 'PROVIDER'">
                            <text class="detail-label">基础售价:</text>
                            <text class="detail-value">¥{{ item.commission['PROVIDER'].markup_amount }}</text>
                        </view>
                        <view class="detail-col" v-if="currentTab === 'AGENT'">
                            <view class="detail-row mb-1">
                                <text class="detail-label">进货价:</text>
                                <text class="detail-value">¥{{ item.commission['AGENT'].cost_price }}</text>
                            </view>
                            <view class="detail-row mb-1">
                                <text class="detail-label">加价额:</text>
                                <text class="detail-value text-success">+¥{{ item.commission['AGENT'].markup_amount }}</text>
                            </view>
                            <view class="detail-row">
                                <text class="detail-label">出售价:</text>
                                <text class="detail-value text-primary">¥{{ item.commission['AGENT'].final_price }}</text>
                            </view>
                        </view>
                    </view>

                    <view class="order-footer">
                        <view class="price-info">
                            <text class="label">订单金额</text>
                            <!-- Consumer sees display_price_snapshot, others see their relevant price -->
                            <text class="value" v-if="currentTab === 'CONSUMER'">¥{{ item.display_price_snapshot }}</text>
                            <text class="value" v-else-if="currentTab === 'AGENT'">¥{{ item.commission['AGENT'].final_price }}</text>
                            <text class="value" v-else>¥{{ item.commission['PROVIDER'].final_price }}</text>
                        </view>
                        <view v-if="item.agent_link && currentTab === 'CONSUMER'" class="agent-info">
                            <text class="icon">👤</text>
                            <text>推荐人: {{ item.agent_link.agent.username }}</text>
                        </view>
                        <!-- Actions based on role -->
                        <view class="actions" v-if="canCancel(item)">
                             <button class="btn btn-sm btn-outline-danger" @click="cancelOrder(item)">取消</button>
                        </view>
                        <view class="actions" v-else-if="currentTab === 'PROVIDER'">
                             <button class="btn btn-sm btn-outline-secondary" @click="hideOrder(item)">删除</button>
                             <button class="btn btn-sm btn-outline-danger" v-if="canProviderCancel(item)" @click="providerCancel(item)">取消</button>
                             <button class="btn btn-sm btn-primary" v-if="canComplete(item)" @click="completeOrder(item)">完成</button>
                        </view>
                    </view>
                </view>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { request } from '@/utils/request';
import { onPullDownRefresh, onShow, onLoad } from '@dcloudio/uni-app';
import dayjs from 'dayjs';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const list = ref<any[]>([]);
const currentTab = ref('CONSUMER'); // CONSUMER | PROVIDER | AGENT
const hideTabs = ref(false);
const focusedId = ref<string | null>(null);
const hiddenProviderIds = ref<string[]>([]);

const switchTab = (tab: string) => {
    currentTab.value = tab;
    if (!hideTabs.value) {
        uni.setStorageSync('last_order_tab', tab);
    }
};

const getTabName = () => {
    if (currentTab.value === 'CONSUMER') return '消费订单';
    if (currentTab.value === 'PROVIDER') return '服务订单';
    if (currentTab.value === 'AGENT') return '代理订单';
    return '';
};

onLoad((options: any) => {
    if (options.tab) {
        currentTab.value = options.tab;
    }
    if (options.hideTabs) {
        hideTabs.value = options.hideTabs === 'true';
        uni.setNavigationBarTitle({ title: getTabName() });
    }
    if (options.id) {
        focusedId.value = options.id;
        if (!options.hideTabs) {
            hideTabs.value = true;
            uni.setNavigationBarTitle({ title: getTabName() });
        }
    }
    try {
        hiddenProviderIds.value = JSON.parse(uni.getStorageSync('hidden_orders_provider') || '[]');
    } catch { hiddenProviderIds.value = []; }
});

const filteredList = computed(() => {
    let data = list.value.filter(item => item.roles && item.roles.includes(currentTab.value));
    if (focusedId.value) {
        data = data.filter(item => item.id === focusedId.value);
    }
    if (currentTab.value === 'PROVIDER' && hiddenProviderIds.value.length) {
        data = data.filter(item => !hiddenProviderIds.value.includes(item.id));
    }
    return data;
});

const loadData = async () => {
  try {
    const res: any = await request({ url: '/order/my' });
    list.value = res;
  } catch (e) {
    console.error(e);
  }
};

const getDay = (t: string) => dayjs(t).format('DD');

onShow(() => {
    if (!hideTabs.value) {
        const lastTab = uni.getStorageSync('last_order_tab');
        if (lastTab) {
            currentTab.value = lastTab;
        }
    }
    loadData();
});
const getMonth = (t: string) => dayjs(t).format('MMM');
const getTime = (t: string) => dayjs(t).format('HH:mm');
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

const canCancel = (item: any) => {
    // Only consumer can cancel for now, and only if RESERVED
    if (currentTab.value !== 'CONSUMER') return false;
    return item.status === 'RESERVED';
};

const cancelOrder = async (item: any) => {
    uni.showModal({
        title: '提示',
        content: '确定要取消预约吗？',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/order/${item.id}/cancel`, method: 'POST' });
                    uni.showToast({ title: '已取消', icon: 'success' });
                    loadData();
                } catch(e) {
                    console.error(e);
                    uni.showToast({ title: '操作失败', icon: 'none' });
                }
            }
        }
    });
};

const canProviderCancel = (item: any) => {
    if (currentTab.value !== 'PROVIDER') return false;
    return item.status === 'PENDING' || item.status === 'RESERVED';
};

const canComplete = (item: any) => {
    if (currentTab.value !== 'PROVIDER') return false;
    return item.status === 'RESERVED' || item.status === 'PENDING';
};

const providerCancel = async (item: any) => {
    uni.showModal({
        title: '取消订单',
        content: '确认取消该订单？将释放时间并退还信用点',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/order/${item.id}/cancel`, method: 'POST' });
                    uni.showToast({ title: '已取消', icon: 'success' });
                    loadData();
                } catch(e) {
                    console.error(e);
                    uni.showToast({ title: '操作失败', icon: 'none' });
                }
            }
        }
    });
};

const completeOrder = async (item: any) => {
    uni.showModal({
        title: '完成订单',
        content: '确认标记该订单为已完成？',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/order/${item.id}/complete`, method: 'POST' });
                    uni.showToast({ title: '已完成', icon: 'success' });
                    loadData();
                } catch(e) {
                    console.error(e);
                    uni.showToast({ title: '操作失败', icon: 'none' });
                }
            }
        }
    });
};

const hideOrder = (item: any) => {
    uni.showModal({
        title: '删除订单',
        content: '删除后该订单将不再显示（记录仍保留）',
        success: (res) => {
            if (res.confirm) {
                const set = new Set(hiddenProviderIds.value);
                set.add(item.id);
                hiddenProviderIds.value = Array.from(set);
                uni.setStorageSync('hidden_orders_provider', JSON.stringify(hiddenProviderIds.value));
                uni.showToast({ title: '已删除', icon: 'success' });
            }
        }
    });
};

onMounted(() => {
  loadData();
});

onPullDownRefresh(async () => {
    await loadData();
    uni.stopPullDownRefresh();
});
</script>

<style>
.tabs-container {
    display: flex;
    background-color: #fff;
    padding: 0 16px;
    margin-bottom: 12px;
    border-radius: 0 0 12px 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.tab-item {
    flex: 1;
    text-align: center;
    padding: 14px 0;
    font-size: 14px;
    color: #64748b;
    position: relative;
    font-weight: 500;
}
.tab-item.active {
    color: #4e97fc;
    font-weight: 600;
}
.tab-line {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 24px;
    height: 3px;
    background-color: #4e97fc;
    border-radius: 3px;
}
.order-card {
    border: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    border-radius: 12px;
}

.order-header {
    display: flex;
    align-items: center;
}

.date-box {
    background-color: #eff6ff;
    color: #4e97fc;
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-right: 12px;
    min-width: 50px;
}
.day { font-size: 18px; font-weight: 700; line-height: 1; }
.month { font-size: 11px; text-transform: uppercase; font-weight: 600; margin-top: 2px; }

.info-col { flex: 1; }
.service-name { font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }
.order-no { font-size: 12px; color: #94a3b8; display: block; margin-bottom: 2px; }
.time-range { font-size: 13px; color: #64748b; }

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

.divider {
    height: 1px;
    background-color: #f1f5f9;
    margin: 12px 0;
}

.role-details {
    background-color: #f8fafc;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 12px;
}
.detail-row {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: #64748b;
}
.detail-col {
    display: flex;
    flex-direction: column;
}
.text-success { color: #28a745; }
.text-primary { color: #4e97fc; }
.mb-1 { margin-bottom: 4px; }

.order-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.price-info {
    display: flex;
    align-items: baseline;
}
.price-info .label { font-size: 12px; color: #94a3b8; margin-right: 6px; }
.price-info .value { font-size: 16px; font-weight: 700; color: #1e293b; }

.agent-info {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: #64748b;
    background-color: #f8fafc;
    padding: 4px 8px;
    border-radius: 6px;
}
.agent-info .icon { margin-right: 4px; }

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

/* Fix layout scrolling issues */
.page-container {
    height: auto !important;
    min-height: 100vh;
    overflow: visible !important;
}

.content-wrapper {
    position: static !important;
    padding-top: calc(56px + 8px) !important;
    height: auto !important;
    overflow-y: visible !important;
}
</style>
