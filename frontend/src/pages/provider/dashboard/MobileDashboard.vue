<template>
    <AppPage :with-navbar="false" :with-tabbar="true" :padding="PAGE_SHELL_PADDING">
        <ServicePanel ref="panel" @show-order-detail="handleShowOrderDetail" />
        <template #tabbar>
            <AppTabBar />
        </template>

        <AppModal v-model:visible="showOrderDetailModal" title="订单详情">
            <OrderDetailComponent v-if="selectedOrderId" :order-id="selectedOrderId" role="PROVIDER" />
        </AppModal>
    </AppPage>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import AppModal from '@/shared/components/AppModal.vue';
import { ServicePanel } from '@/domains/provider';
import { OrderDetailComponent } from '@/domains/order';
import { PAGE_SHELL_PADDING } from '@/constants/layout-shell';

const panel = ref<any>(null);
const isFirstShow = ref(true);

const showOrderDetailModal = ref(false);
const selectedOrderId = ref('');

const handleShowOrderDetail = (orderId: string) => {
    selectedOrderId.value = orderId;
    showOrderDetailModal.value = true;
};

onShow(() => {
    if (isFirstShow.value) {
        isFirstShow.value = false;
        return;
    }
    panel.value?.refresh?.();
});
</script>