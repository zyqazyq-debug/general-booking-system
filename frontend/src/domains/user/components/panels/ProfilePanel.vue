<template>
    <view class="content-wrapper">
        <ProfileHeaderCard :username="userStore.userInfo?.username" @settings="goToSettings" />
        <text v-if="!creditReady" class="refresh-tip">刷新中...</text>

        <view class="profile-cards-container">
            <ProfileAssetsCard
                :t="t"
                :wallet-balance="userStore.userInfo?.wallet_balance || '0.00'"
                :credit-ready="creditReady"
                :total-credit="totalCredit"
                :active-reserved-orders="activeReservedOrders"
                :dynamic-frozen-credit="dynamicFrozenCredit"
                @recharge="recharge"
            />
            <ProfileMenuGrid
                :t="t"
                :current-lang-label="currentLangLabel"
                :lang-options="langOptions"
                @go-order="goToOrder"
                @go-referral="goToReferral"
                @lang-change="onLangChange"
                @go-help="goToHelp"
                @logout="handleLogout"
            />
        </view>

        <!-- Extracted Profile Edit Drawer -->
        <ProfileEditDrawer 
            v-model:visible="showProfileDrawer"
            @saved="onProfileSaved"
        />

        <AppModal v-model:visible="showHelpDrawer" :title="t('profile.help_center')">
            <HelpCenterComponent />
        </AppModal>

        <AppModal
            v-model:visible="showReferralIncomeModal"
            :title="t('profile.referral_income')"
        >
            <component :is="referralIncomeRenderer" v-if="referralIncomeRenderer" />
            <view v-else class="referral-placeholder">暂未配置回馈面板</view>
        </AppModal>

        <AppModal
            v-model:visible="showOrderListModal"
            :title="orderListTitle"
        >
            <OrderListComponent :tab="orderModalRole" :hide-tabs="true" @order-click="onOrderClickInModal" />
        </AppModal>

        <AppModal
            v-model:visible="showOrderDetailModal"
            title="订单详情"
            @close="onOrderDetailClose"
        >
            <OrderDetailComponent :order-id="selectedOrderId" :role="orderModalRole" />
        </AppModal>
    </view>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useUserStore } from '@/shared/stores/user';
import AppModal from '@/shared/components/AppModal.vue';
import ProfileEditDrawer from './profile/ProfileEditDrawer.vue';
import ProfileHeaderCard from './profile/components/ProfileHeaderCard.vue';
import ProfileAssetsCard from './profile/components/ProfileAssetsCard.vue';
import ProfileMenuGrid from './profile/components/ProfileMenuGrid.vue';
import { HelpCenterComponent } from '@/domains/help';
import { OrderListComponent, OrderDetailComponent } from '@/domains/order';
import { useProfilePanelState } from './profile/composables/useProfilePanelState';

defineProps<{
  referralIncomeRenderer?: any;
}>();

const userStore = useUserStore();
const { t, locale } = useI18n();
const {
  showProfileDrawer,
  showHelpDrawer,
  showReferralIncomeModal,
  showOrderListModal,
  showOrderDetailModal,
  orderModalRole,
  selectedOrderId,
  creditReady,
  activeReservedOrders,
  dynamicFrozenCredit,
  langOptions,
  currentLangLabel,
  totalCredit,
  orderListTitle,
  goToSettings,
  onProfileSaved,
  recharge,
  goToOrder,
  onOrderClickInModal,
  onOrderDetailClose,
  goToReferral,
  goToHelp,
  onLangChange,
  handleLogout,
  refresh,
} = useProfilePanelState({
  userStore,
  locale,
});

defineExpose({
    refresh
});
</script>

<style lang="scss" scoped>
.content-wrapper {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    /* Removed overflow hidden */
}

/* Container for cards to apply gap */
.profile-cards-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
}

.refresh-tip {
    width: 100%;
    text-align: center;
    font-size: 12px;
    color: $uni-text-color-placeholder;
}

.referral-placeholder {
    color: $uni-text-color-grey;
    font-size: 14px;
    text-align: center;
    padding: 16px 0;
}

</style>
