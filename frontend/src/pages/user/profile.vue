<template>
  <view class="page-container no-top-nav has-bottom-tab">
    
    <view class="content-wrapper">
        <!-- User Profile Card -->
        <view class="card profile-card">
            <view class="card-body profile-body">
                <view class="avatar">
                    <text style="font-size: 30px;">👤</text>
                </view>
                <view class="profile-info">
                    <text class="username">{{ userStore.userInfo?.username }}</text>
                    <text class="role-badge">{{ userStore.currentRole }}</text>
                    <text class="edit-link" @click="editProfile">修改资料 ></text>
                </view>
            </view>
        </view>

        <!-- Assets Card -->
        <view class="card">
            <view class="card-header">我的资产</view>
            <view class="card-body">
                <view class="assets-row">
                    <view class="asset-item">
                        <text class="label">余额 (元)</text>
                        <text class="value">¥{{ userStore.userInfo?.wallet_balance || '0.00' }}</text>
                        <button class="btn btn-sm btn-primary" @click="recharge">充值</button>
                    </view>
                    <view class="asset-item">
                        <text class="label">信用分</text>
                        <text class="value text-success">{{ userStore.userInfo?.credit_balance || 100 }}</text>
                        <text class="desc">信用极好</text>
                    </view>
                </view>
            </view>
        </view>

        <!-- Order Management Card -->
        <view class="card">
            <view class="card-header">订单管理</view>
            <view class="card-body pt-0">
                <view class="order-grid">
                    <view class="grid-item" @click="goToOrder('PROVIDER')">
                         <view class="icon-circle bg-purple-light">
                            <text class="grid-icon">🛠️</text>
                         </view>
                        <text class="grid-label">服务订单</text>
                    </view>
                    <view class="grid-item" @click="goToOrder('AGENT')">
                         <view class="icon-circle bg-green-light">
                            <text class="grid-icon">🤝</text>
                         </view>
                        <text class="grid-label">代理订单</text>
                    </view>
                    <view class="grid-item" @click="goToOrder('CONSUMER')">
                        <view class="icon-circle bg-blue-light">
                            <text class="grid-icon">💴</text>
                        </view>
                        <text class="grid-label">消费订单</text>
                    </view>
                </view>
            </view>
        </view>

        <!-- Menu List -->
        <view class="card menu-card">
            <view class="menu-item" @click="goToLedger">
                <view class="left">
                    <text class="icon">💰</text>
                    <text>资金明细</text>
                </view>
                <text class="arrow">></text>
            </view>
            <view class="menu-item" @click="goToSettings">
                <view class="left">
                    <text class="icon">⚙️</text>
                    <text>设置</text>
                </view>
                <text class="arrow">></text>
            </view>
        </view>

        <button class="btn logout-btn" @click="handleLogout">退出登录</button>
    </view>

    <!-- Bottom Tab Bar -->
    <view class="bottom-tab" v-if="userStore.userInfo">
        <view class="tab-item" @click="goToHome">
            <text class="tab-icon">🛠️</text>
            <text>我的服务</text>
        </view>
        <view class="tab-item" @click="goToCollection">
            <text class="tab-icon">⭐</text>
            <text>收藏</text>
        </view>
        <view class="tab-item active">
            <text class="tab-icon">👤</text>
            <text>个人中心</text>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();

const goToHome = () => uni.reLaunch({ url: '/pages/index/index' });
const goToCollection = () => uni.reLaunch({ url: '/pages/schedule/collection' }); // Map to list?filter=collection
const goToOrder = (tab: string) => uni.navigateTo({ url: `/pages/order/list?tab=${tab}&hideTabs=true` });

const editProfile = () => uni.showToast({ title: '修改资料开发中', icon: 'none' });
const recharge = () => uni.showToast({ title: '充值功能开发中', icon: 'none' });
const goToLedger = () => uni.showToast({ title: '资金明细开发中', icon: 'none' });
const goToSettings = () => uni.showToast({ title: '设置开发中', icon: 'none' });

const handleLogout = () => {
    userStore.logout();
    uni.reLaunch({ url: '/pages/login/login' });
};

</script>

<style scoped>
/* Compact Styles for Profile Page */
.page-container .card {
    margin-bottom: 10px;
    border-radius: 8px;
}
.page-container .card-header {
    padding: 8px 12px;
    font-size: 14px;
}
.page-container .card-body {
    padding: 10px 12px;
}
.page-container .content-wrapper {
    padding: 10px;
    display: flex;
    flex-direction: column;
    /* justify-content: space-between; Try to distribute space if height allows */
}

.profile-body {
    display: flex;
    align-items: center;
    padding: 4px 0; /* Reduce padding inside profile body */
}
.avatar {
    width: 40px;
    height: 40px;
    background-color: #f1f5f9;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 10px;
}
.avatar text {
    font-size: 24px !important; /* Override inline style */
}
.profile-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
}
.username {
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 0;
    line-height: 1.2;
}
.role-badge {
    font-size: 10px;
    background-color: #eff6ff;
    color: #4e97fc;
    padding: 1px 4px;
    border-radius: 4px;
    align-self: flex-start;
    margin-bottom: 0;
    margin-top: 2px;
}
.edit-link {
    font-size: 10px;
    color: #94a3b8;
    margin-top: 2px;
}

.assets-row {
    display: flex;
    flex-direction: column;
    padding: 0;
}
.asset-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #f1f5f9;
}
.asset-item:last-child { border-bottom: none; border-right: none; }
.asset-item .label { 
    font-size: 14px; 
    color: #64748b; 
    margin-bottom: 0; 
    width: 80px;
}
.asset-item .value { 
    font-size: 16px; 
    font-weight: 700; 
    color: #1e293b; 
    margin-bottom: 0; 
    line-height: 1.2;
    margin-right: 10px;
}
.asset-item .desc { 
    font-size: 12px; 
    color: #94a3b8; 
    margin-left: auto;
}
.asset-item .btn-sm { 
    margin-top: 0 !important; 
    font-size: 12px; 
    padding: 4px 12px; 
    line-height: 1.5;
    height: auto;
    margin-left: auto;
}



.menu-card { padding: 0; }
.menu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
}
.menu-item:active { background-color: #f8fafc; }
.menu-item:last-child { border-bottom: none; }
.menu-item .left { display: flex; align-items: center; font-size: 13px; color: #334155; }
.menu-item .icon { margin-right: 8px; font-size: 14px; }
.menu-item .arrow { color: #cbd5e1; font-size: 12px; }

.order-grid {
    display: flex;
    justify-content: space-around;
    padding-bottom: 0;
}
.grid-item {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.icon-circle {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
}
.grid-icon { font-size: 18px; }
.grid-label { font-size: 11px; color: #334155; font-weight: 500; }
.bg-green-light { background-color: #f0fdf4; }
.bg-blue-light { background-color: #eff6ff; }
.bg-purple-light { background-color: #faf5ff; }

.logout-btn {
    margin-top: 10px;
    font-size: 14px;
    padding: 8px 0;
    line-height: 1.5;
}
</style>
