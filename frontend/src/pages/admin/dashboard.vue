<template>
  <view class="page-container">
    <view class="top-nav">
       <text class="page-title">系统管理后台</text>
       <text class="logout-link" @click="logout">退出</text>
    </view>
    
    <view class="content-wrapper">
        <!-- Dashboard Stats -->
        <view class="row mb-3">
            <view class="col-6 mb-2">
                <view class="card p-3 stat-card">
                    <text class="stat-num">{{ stats.users }}</text>
                    <text class="stat-label">总用户</text>
                </view>
            </view>
            <view class="col-6 mb-2">
                <view class="card p-3 stat-card">
                    <text class="stat-num">{{ stats.orders }}</text>
                    <text class="stat-label">总订单</text>
                </view>
            </view>
        </view>

        <!-- Tabs -->
        <view class="tab-bar mb-3">
            <view class="tab-btn" :class="{ active: currentTab === 'users' }" @click="currentTab = 'users'">用户管理</view>
            <view class="tab-btn" :class="{ active: currentTab === 'schedules' }" @click="currentTab = 'schedules'">服务管理</view>
            <view class="tab-btn" :class="{ active: currentTab === 'orders' }" @click="currentTab = 'orders'">订单管理</view>
            <view class="tab-btn" :class="{ active: currentTab === 'agency' }" @click="currentTab = 'agency'">中介管理</view>
        </view>

        <!-- Users List -->
        <view v-if="currentTab === 'users'" class="list-container">
            <view class="card mb-2" v-for="u in users" :key="u.id">
                <view class="card-body py-2">
                    <view class="d-flex justify-between">
                        <text class="font-bold">{{ u.username }}</text>
                        <text class="text-muted text-xs">{{ u.roles.join(',') }}</text>
                    </view>
                    <view class="d-flex justify-between mt-1">
                        <text class="text-sm">余额: ¥{{ u.wallet_balance }}</text>
                        <text class="text-sm">积分: {{ u.credit_balance }}</text>
                    </view>
                </view>
            </view>
        </view>

        <!-- Schedules List -->
        <view v-if="currentTab === 'schedules'" class="list-container">
            <view class="card mb-2" v-for="s in schedules" :key="s.id">
                <view class="card-body py-2">
                    <view class="d-flex justify-between">
                        <text class="font-bold">{{ s.title }}</text>
                        <text class="badge" :class="s.is_active ? 'badge-success' : 'badge-gray'">{{ s.is_active ? '上架' : '下架' }}</text>
                    </view>
                    <text class="text-xs text-muted block mt-1">发布者: {{ s.owner?.username }}</text>
                    <text class="text-sm block mt-1">价格: ¥{{ s.base_price }} | 积分: {{ s.deposit_points }}</text>
                </view>
            </view>
        </view>

        <!-- Orders List -->
        <view v-if="currentTab === 'orders'" class="list-container">
            <view class="card mb-2" v-for="o in orders" :key="o.id">
                <view class="card-body py-2">
                    <view class="d-flex justify-between">
                        <text class="text-sm font-bold">订单 #{{ o.id.substring(0,8) }}</text>
                        <text class="text-xs">{{ o.status }}</text>
                    </view>
                    <view class="mt-2 text-xs text-muted">
                        <view>服务: {{ o.schedule?.title }}</view>
                        <view>买家: {{ o.consumer?.username }}</view>
                        <view>时间: {{ formatTime(o.start_time) }} - {{ formatTime(o.end_time) }}</view>
                        <view v-if="o.agent_link">推广人: {{ o.agent_link.agent?.username }}</view>
                    </view>
                </view>
            </view>
        </view>

        <!-- Agency List -->
        <view v-if="currentTab === 'agency'" class="list-container">
            <view class="card mb-2" v-for="a in collections" :key="a.id">
                <view class="card-body py-2">
                    <view class="d-flex justify-between">
                        <text class="font-bold">{{ a.service?.title }}</text>
                        <text class="text-xs text-primary">Slug: {{ a.share_slug }}</text>
                    </view>
                    <view class="mt-1 text-xs text-muted">
                        <view>收藏者: {{ a.agent?.username }}</view>
                        <view>原作者: {{ a.service?.owner?.username }}</view>
                        <view>加价: ¥{{ a.markup_amount }}</view>
                    </view>
                </view>
            </view>
        </view>

    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/stores/user';
import { request } from '@/utils/request';
import dayjs from 'dayjs';

const userStore = useUserStore();
const currentTab = ref('users');
const users = ref<any[]>([]);
const schedules = ref<any[]>([]);
const orders = ref<any[]>([]);
const collections = ref<any[]>([]);

const stats = computed(() => ({
    users: users.value.length,
    orders: orders.value.length
}));

onMounted(() => {
    loadAllData();
});

const loadAllData = async () => {
    try {
        uni.showLoading({ title: '加载中...' });
        
        // Load data sequentially or handle errors individually to avoid total failure
        try {
            const uRes = await request({ url: '/admin/users' });
            users.value = Array.isArray(uRes) ? uRes : [];
        } catch(e) { console.error('Users load failed', e); }

        try {
            const sRes = await request({ url: '/admin/schedules' });
            schedules.value = Array.isArray(sRes) ? sRes : [];
        } catch(e) { console.error('Schedules load failed', e); }

        try {
            const oRes = await request({ url: '/admin/orders' });
            orders.value = Array.isArray(oRes) ? oRes : [];
        } catch(e) { console.error('Orders load failed', e); }

        try {
            const cRes = await request({ url: '/admin/collections' });
            collections.value = Array.isArray(cRes) ? cRes : [];
        } catch(e) { console.error('Collections load failed', e); }

    } catch (e) {
        console.error(e);
        uni.showToast({ title: '加载失败', icon: 'none' });
    } finally {
        uni.hideLoading();
    }
};

const formatTime = (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm');

const logout = () => {
    userStore.logout();
    uni.reLaunch({ url: '/pages/login/login' });
};
</script>

<style>
.logout-link { font-size: 14px; color: #ef4444; }
.stat-card { text-align: center; }
.stat-num { font-size: 24px; font-weight: bold; color: #4e97fc; display: block; }
.stat-label { font-size: 12px; color: #64748b; }

.tab-bar {
    display: flex;
    background: #fff;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
}
.tab-btn {
    flex: 1;
    text-align: center;
    padding: 8px 0;
    font-size: 13px;
    color: #64748b;
    border-radius: 6px;
}
.tab-btn.active {
    background-color: #eff6ff;
    color: #4e97fc;
    font-weight: 600;
}

.badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; color: #fff; }
.badge-success { background-color: #28a745; }
.badge-gray { background-color: #94a3b8; }

.d-flex { display: flex; }
.justify-between { justify-content: space-between; }
.font-bold { font-weight: 600; }
.text-xs { font-size: 11px; }
.text-sm { font-size: 13px; }
.text-muted { color: #94a3b8; }
.block { display: block; }
.mt-1 { margin-top: 4px; }
.py-2 { padding-top: 8px; padding-bottom: 8px; }
</style>