<template>
  <view class="list-container">
    <view class="list-header">回馈明细</view>

    <view v-if="logs.length === 0" class="empty-state">
      <text class="empty-icon">💸</text>
      <text class="empty-text">暂无回馈记录</text>
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
        <text class="amount">+{{ Number(log.amount).toFixed(4) }}</text>
        <text class="base-amount">基数: ¥{{ log.base_amount }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import type { ReferralLog } from '../api/referral';

defineProps<{
  logs: ReferralLog[];
}>();

const formatTime = (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm');
</script>

<style scoped>
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
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
