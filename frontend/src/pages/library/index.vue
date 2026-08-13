<template>
    <view v-if="isPC" class="pc-root">
        <PCDashboard :query="query" />
    </view>
    <AppPage v-else ref="appPageRef" :with-navbar="false" :with-tabbar="true" :padding="PAGE_SHELL_PADDING">
        <LibraryIndexImpl 
            ref="panel"
            :edit-id="query.editId"
            :check-scrollable="checkScrollableMobile"
            @open-booking="handleOpenBooking"
        />
        <template #tabbar>
            <AppTabBar />
        </template>
    </AppPage>
    <BookingModal ref="bookingModal" />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { onShow, onLoad } from '@dcloudio/uni-app';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { LibraryIndexImpl } from '@/domains/library';
import { BookingModal } from '@/domains/booking';
import { PAGE_SHELL_PADDING } from '@/constants/layout-shell';
import { usePCMode } from '@/core/ui/usePCMode';

// Async import
const PCDashboard = defineAsyncComponent(
  () => import('@/pages/provider/dashboard/PCDashboard.vue'),
);

const { isPC } = usePCMode();
const panel = ref<any>(null);
const appPageRef = ref<any>(null);
const query = ref<any>({});
const isFirstShow = ref(true);
const bookingModal = ref<any>(null);

const handleOpenBooking = (params: any) => {
    bookingModal.value?.open(params);
};

onLoad((opts) => {
    query.value = opts || {};
});

onShow(() => {
    if (!isPC.value) {
        if (isFirstShow.value) {
            isFirstShow.value = false;
            return;
        }
        panel.value?.refresh?.();
    }
});

const checkScrollableMobile = () => {
    appPageRef.value?.checkScrollable?.();
};
</script>

<style scoped>
.pc-root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
}
</style>
