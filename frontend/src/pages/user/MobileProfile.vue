<template>
  <AppPage title="我的" :with-navbar="false" :with-tabbar="true" :padding="PAGE_SHELL_PADDING">
    <ProfilePanel 
      ref="panel" 
      :referral-income-renderer="referralIncomeRenderer"
      @show-help="showHelpDrawer = true"
      @show-order-list="handleShowOrderList"
      @show-order-detail="handleShowOrderDetail"
    />

    <template #tabbar>
      <AppTabBar />
    </template>

    <AppModal v-model:visible="showHelpDrawer" title="帮助中心">
      <HelpCenterComponent />
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
    >
        <OrderDetailComponent :order-id="selectedOrderId" :role="orderModalRole" />
    </AppModal>
  </AppPage>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from 'vue';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import AppModal from '@/shared/components/AppModal.vue';
import { ProfilePanel } from '@/domains/user';
import { HelpCenterComponent } from '@/domains/help';
import { OrderListComponent, OrderDetailComponent, getOrderRoleLabel } from '@/domains/order';
import { PAGE_SHELL_PADDING } from '@/constants/layout-shell';

const props = defineProps<{
    query: any;
    isShown: boolean;
    referralIncomeRenderer?: any;
}>();

const panel = ref<any>(null);

const showHelpDrawer = ref(false);
const showOrderListModal = ref(false);
const showOrderDetailModal = ref(false);
const orderModalRole = ref('CONSUMER');
const selectedOrderId = ref('');

const orderListTitle = computed(() => getOrderRoleLabel(orderModalRole.value));

const handleShowOrderList = (role: string) => {
    orderModalRole.value = role;
    selectedOrderId.value = '';
    showOrderDetailModal.value = false;
    showOrderListModal.value = true;
};

const handleShowOrderDetail = (payload: { id: string; role: string }) => {
    selectedOrderId.value = payload.id;
    orderModalRole.value = payload.role;
    showOrderDetailModal.value = true;
};

const onOrderClickInModal = (payload: { id: string; role: string }) => {
    selectedOrderId.value = payload.id;
    orderModalRole.value = payload.role;
    nextTick(() => {
        showOrderDetailModal.value = true;
    });
};

const handleQueryAction = (action: string) => {
    if (action === 'orders' || action === 'order') {
        panel.value?.goToOrder?.('CONSUMER');
    } else if (action === 'referral') {
        panel.value?.goToReferral?.();
    } else if (action === 'help') {
        panel.value?.goToHelp?.();
    }
};

watch(() => props.isShown, (newVal) => {
    if (newVal) {
        panel.value?.refresh?.();
    }
});

onMounted(() => {
    if (props.query?.action) {
        setTimeout(() => {
            handleQueryAction(props.query.action);
        }, 300);
    }
});
</script>
