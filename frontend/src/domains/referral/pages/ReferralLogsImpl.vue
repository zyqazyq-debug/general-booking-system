<template>
  <view class="page-container">
    <view class="top-nav">
      <view class="nav-left" @click="goBack">
        <text class="arrow-left">←</text>
      </view>
      <text class="page-title">推广收益</text>
      <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
      <view class="summary-card">
        <view class="summary-body">
            <view class="total-label">累计返利收益 (元)</view>
            <view class="total-amount">¥{{ totalAmount.toFixed(4) }}</view>
        </view>
      </view>

      <view class="list-container">
        <view class="list-header">收益明细</view>
        
        <view v-if="logs.length === 0" class="empty-state">
            <text class="empty-icon">💸</text>
            <text class="empty-text">暂无返利记录</text>
        </view>

        <view v-for="log in logs" :key="log.id" class="log-item">
            <view class="log-left">
                <view class="log-title">
                    <text class="level-tag">L{{ log.level }}</text>
                    <text class="source-user">来自: {{ log.sourceUser?.username || '未知用户' }}</text>
                </view>
                <view class="log-time">{{ formatTime(log.created_at) }}</view>
            </view>
            <view class="log-right">
                <text class="amount">+{{ log.amount.toFixed(4) }}</text>
                <text class="base-amount">基数: ¥{{ log.base_amount }}</text>
            </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getReferralLogs, type ReferralLog } from '../api/referral';

import dayjs from 'dayjs';

const logs = ref<ReferralLog[]>([]);

const totalAmount = computed(() => {
    return logs.value.reduce((sum, log) => sum + Number(log.amount), 0);
});

const loadData = async () => {
    try {
        const res = await getReferralLogs();
        logs.value = res;
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '加载失败', icon: 'none' });
    }
};

onMounted(() => {
    loadData();
});

const emit = defineEmits<{
    (e: 'back'): void;
}>();

const goBack = () => {
    emit('back');
};
const formatTime = (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm');

</script>

<style>
.summary-card {
    background: linear-gradient(135deg, #4e97fc 0%, #6366f1 100%);
    color: white;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
    box-shadow: 0 4px 12px rgba(78, 151, 252, 0.3);
}
.summary-body {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.total-label {
    font-size: 14px;
    opacity: 0.9;
    margin-bottom: 8px;
}
.total-amount {
    font-size: 32px;
    font-weight: 700;
}

.list-header {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 12px;
    padding-left: 4px;
}

.log-item {
    background: white;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
}

.log-left {
    display: flex;
    flex-direction: column;
}
.log-title {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
}
.level-tag {
    background-color: #eff6ff;
    color: #4e97fc;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-right: 6px;
    font-weight: 600;
}
.source-user {
    font-size: 14px;
    color: #334155;
    font-weight: 500;
}
.log-time {
    font-size: 12px;
    color: #94a3b8;
}

.log-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}
.amount {
    font-size: 16px;
    font-weight: 600;
    color: #28a745;
    margin-bottom: 2px;
}
.base-amount {
    font-size: 10px;
    color: #94a3b8;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 0;
    color: #94a3b8;
}
.empty-icon {
    font-size: 40px;
    margin-bottom: 10px;
    opacity: 0.5;
}
.empty-text {
    font-size: 14px;
}
</style>