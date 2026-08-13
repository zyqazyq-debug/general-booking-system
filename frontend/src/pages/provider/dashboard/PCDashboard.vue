<template>
    <view class="pc-dashboard">
        <AppConfirmHost />
        <view class="pc-column">
            <view class="pc-column-header">
                <text class="column-title">我的服务</text>
            </view>
            <view class="pc-column-body">
                <ServicePanel ref="servicePanel" />
            </view>
        </view>

        <view class="pc-column">
            <view class="pc-column-header">
                <text class="column-title">我的收藏</text>
            </view>
            <view class="pc-column-body">
                <LibraryIndexImpl ref="libraryPanel" :edit-id="query?.editId" :check-scrollable="checkScrollable" @open-booking="handleOpenBooking" />
            </view>
        </view>

        <view class="pc-column">
            <view class="pc-column-header">
                <text class="column-title">个人中心</text>
            </view>
            <view class="pc-column-body">
                <ProfilePanel ref="profilePanel" />
            </view>
        </view>
        
        <BookingModal ref="bookingModal" />
    </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ServicePanel } from '@/domains/provider';
import { LibraryIndexImpl } from '@/domains/library';
import { ProfilePanel } from '@/domains/user';
import { BookingModal } from '@/domains/booking';
import AppConfirmHost from '@/shared/components/AppConfirmHost.vue';

defineProps<{
    query?: any;
}>();

const servicePanel = ref<any>(null);
const libraryPanel = ref<any>(null);
const profilePanel = ref<any>(null);
const bookingModal = ref<any>(null);

const handleOpenBooking = (params: any) => {
    bookingModal.value?.open(params);
};

const checkScrollable = () => {};

const refreshAll = () => {
    servicePanel.value?.refresh?.();
    libraryPanel.value?.refresh?.();
    profilePanel.value?.refresh?.();
};

defineExpose({
    refreshAll
});
</script>

<style scoped>
.pc-dashboard {
    width: 100vw;
    height: 100vh;
    background-color: #f1f5f9;
    padding: 24px;
    display: flex;
    flex-direction: row;
    gap: 24px;
    box-sizing: border-box;
    overflow: hidden;
}

.pc-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    background-color: #fff;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    overflow: hidden;
    min-width: 0;
}

.pc-column-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    background-color: #fff;
    flex: 0 0 auto;
}

.column-title {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
}

.pc-column-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    scrollbar-width: thin;
    scrollbar-color: #cbd5e1 transparent;
}

.pc-column-body::-webkit-scrollbar {
    width: 6px;
}

.pc-column-body::-webkit-scrollbar-track {
    background: transparent;
}

.pc-column-body::-webkit-scrollbar-thumb {
    background-color: #cbd5e1;
    border-radius: 3px;
}
</style>
