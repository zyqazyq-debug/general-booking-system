<template>
  <view class="referral-logs-comp">
    <view class="summary-card">
      <view class="summary-body">
          <view class="total-label">累计分享回馈 (元)</view>
          <view class="total-amount">¥{{ totalAmount.toFixed(4) }}</view>
      </view>
    </view>

    <ReferralPromoShareCard
      :promotion-link="promotionLink"
      note-text="回馈说明：回馈为下级软件使用费的50%，不是服务消费金额。"
    />

    <ReferralLogsList :logs="logs" />
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getReferralLogs, type ReferralLog } from '../api/referral';
import { useUserStore } from '@/shared/stores/user';
import ReferralPromoShareCard from './ReferralPromoShareCard.vue';
import ReferralLogsList from './ReferralLogsList.vue';
import { useReferralPromotionLink } from '../composables/useReferralPromotionLink';

const logs = ref<ReferralLog[]>([]);
const userStore = useUserStore();
const { promotionLink } = useReferralPromotionLink();

const totalAmount = computed(() => {
    return logs.value.reduce((sum: number, log: ReferralLog) => sum + Number(log.amount), 0);
});

const loadData = async () => {
    try {
        const res = await getReferralLogs();
        logs.value = res;
        // Also refresh user info to ensure referral_code is up to date
        await userStore.refreshUserInfo();
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '加载失败', icon: 'none' });
    }
};

onMounted(() => {
    loadData();
});
</script>

<style lang="scss" scoped>
.summary-card {
    background: linear-gradient(135deg, $uni-color-primary 0%, #6366f1 100%);
    color: white;
    border-radius: $uni-radius-lg;
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

</style>
