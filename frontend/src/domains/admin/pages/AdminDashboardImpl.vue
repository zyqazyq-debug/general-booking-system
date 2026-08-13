<template>
  <AppPage title="系统管理后台" :with-navbar="true" :show-back="false" :padding="'16px'">
    <template #nav-right>
      <text class="logout-link" @click="logout">退出</text>
    </template>
    <view class="admin-dashboard-page">
        <!-- Dashboard Stats -->
        <view class="stats-grid section-gap">
            <view class="stats-col card-gap">
                <AppCard :padding="'16px'" class="stat-card">
                    <text class="stat-num">{{ stats.users }}</text>
                    <text class="stat-label">总用户</text>
                </AppCard>
            </view>
            <view class="stats-col card-gap">
                <AppCard :padding="'16px'" class="stat-card">
                    <text class="stat-num">{{ stats.orders }}</text>
                    <text class="stat-label">总订单</text>
                </AppCard>
            </view>
        </view>

        <!-- Tabs -->
        <view class="tab-bar section-gap">
            <view class="tab-action" :class="{ active: currentTab === 'users' }" @click="currentTab = 'users'">用户管理</view>
            <view class="tab-action" :class="{ active: currentTab === 'services' }" @click="currentTab = 'services'">服务管理</view>
            <view class="tab-action" :class="{ active: currentTab === 'orders' }" @click="currentTab = 'orders'">订单管理</view>
            <view class="tab-action" :class="{ active: currentTab === 'agency' }" @click="currentTab = 'agency'">中介管理</view>
        </view>

        <!-- Users List -->
        <view v-if="currentTab === 'users'" class="list-container">
            <AppCard v-for="u in users" :key="u.id" class="list-card-gap" :padding="'8px 12px'">
                    <view class="row-between">
                        <text class="font-bold">{{ u.username }}</text>
                        <text class="muted-text text-xs">{{ u.roles.join(',') }}</text>
                    </view>
                    <view class="row-between item-meta-gap">
                        <text class="text-sm">余额: ¥{{ u.wallet_balance }}</text>
                        <text class="text-sm">积分: {{ u.credit_balance }}</text>
                    </view>
            </AppCard>
        </view>

        <!-- Services List -->
        <view v-if="currentTab === 'services'" class="list-container">
            <AppCard v-for="s in services" :key="s.id" class="list-card-gap" :padding="'8px 12px'">
                    <view class="row-between">
                        <text class="font-bold">{{ s.title }}</text>
                        <text class="badge" :class="s.is_active ? 'badge-success' : 'badge-gray'">{{ s.is_active ? '上架' : '下架' }}</text>
                    </view>
                    <text class="text-xs muted-text block item-meta-gap">发布者: {{ s.owner?.username }}</text>
                    <text class="text-sm block item-meta-gap">价格: ¥{{ s.base_price }} | 积分: {{ s.deposit_points }}</text>
            </AppCard>
        </view>

        <!-- Orders List -->
        <view v-if="currentTab === 'orders'" class="list-container">
            <AppCard v-for="o in orders" :key="o.id" class="list-card-gap" :padding="'8px 12px'">
                    <view class="row-between">
                        <text class="text-sm font-bold">订单 #{{ o.id.substring(0,8) }}</text>
                        <text class="text-xs">{{ o.status }}</text>
                    </view>
                    <view class="order-detail-group text-xs muted-text detail-group-gap">
                        <view>服务: {{ o.service?.title }}</view>
                        <view>买家: {{ o.consumer?.username }}</view>
                        <view>时间: {{ formatTime(o.start_time) }} - {{ formatTime(o.end_time) }}</view>
                        <view v-if="o.agency_node">分享人: {{ o.agency_node.agent?.username }}</view>
                    </view>
            </AppCard>
        </view>

        <!-- Agency List -->
        <view v-if="currentTab === 'agency'" class="list-container">
            <AppCard v-for="a in collections" :key="a.id" class="list-card-gap" :padding="'8px 12px'">
                    <view class="row-between">
                        <text class="font-bold">{{ a.service?.title }}</text>
                        <text class="text-xs highlight-text">Slug: {{ a.share_slug }}</text>
                    </view>
                    <view class="item-meta-gap text-xs muted-text">
                        <view>收藏者: {{ a.agent?.username }}</view>
                        <view>原作者: {{ a.service?.owner?.username }}</view>
                        <view>加价: ¥{{ a.markup_amount }}</view>
                    </view>
            </AppCard>
        </view>

    </view>
  </AppPage>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { getAdminUsers, getAdminServices, getAdminOrders, getAdminCollections } from '../api/admin';
import dayjs from 'dayjs';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';

const userStore = useUserStore();
const currentTab = ref('users');
const users = ref<any[]>([]);
const services = ref<any[]>([]);
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
            const uRes = await getAdminUsers();
            users.value = Array.isArray(uRes) ? uRes : [];
        } catch(e) { console.error('Users load failed', e); }

        try {
            const sRes = await getAdminServices();
            services.value = Array.isArray(sRes) ? sRes : [];
        } catch(e) { console.error('Services load failed', e); }

        try {
            const oRes = await getAdminOrders();
            orders.value = Array.isArray(oRes) ? oRes : [];
        } catch(e) { console.error('Orders load failed', e); }

        try {
            const cRes = await getAdminCollections();
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

<style lang="scss" scoped>
.admin-dashboard-page {
    width: 100%;
}
.stats-grid {
    display: flex;
}
.stats-col {
    width: 50%;
}
.section-gap {
    margin-bottom: 12px;
}
.card-gap {
    margin-bottom: 8px;
}
.list-card-gap {
    margin-bottom: 8px;
}
.row-between {
    display: flex;
    justify-content: space-between;
}
.item-meta-gap {
    margin-top: 4px;
}
.detail-group-gap {
    margin-top: 8px;
}
.muted-text {
    color: $uni-text-color-placeholder;
}
.highlight-text {
    color: $uni-color-primary;
}
.logout-link { font-size: 14px; color: $uni-color-error; }
.stat-card { text-align: center; }
.stat-num { font-size: 24px; font-weight: bold; color: $uni-color-primary; display: block; }
.stat-label { font-size: 12px; color: $uni-text-color-grey; }

.tab-bar {
    display: flex;
    background: $uni-bg-color;
    padding: 4px;
    border-radius: $uni-radius-base;
    border: 1px solid $uni-border-color;
}
.tab-action {
    flex: 1;
    text-align: center;
    padding: 8px 0;
    font-size: 13px;
    color: $uni-text-color-grey;
    border-radius: 6px;
}
.tab-action.active {
    background-color: $uni-color-primary-light;
    color: $uni-color-primary;
    font-weight: 600;
}

.badge { padding: 2px 6px; border-radius: $uni-radius-sm; font-size: 10px; color: $uni-bg-color; }
.badge-success { background-color: $uni-color-success; }
.badge-gray { background-color: $uni-text-color-placeholder; }

.font-bold { font-weight: 600; }
.text-xs { font-size: 11px; }
.text-sm { font-size: 13px; }
.block { display: block; }
</style>
