<template>
  <AppPage :title="isLoggedIn ? '预约详情' : ''" :with-navbar="isLoggedIn" :with-tabbar="isLoggedIn" padding="0">
    <view class="booking-content-wrapper">
      <BookingModal ref="bookingModal" @close="goBack" @success="handleBookingSuccess" />
    </view>

    <template #tabbar>
      <AppTabBar v-if="isLoggedIn" />
    </template>
  </AppPage>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import BookingModal from '../components/BookingModal.vue';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { useBookingImport } from '../composables/useBookingImport';

const props = defineProps<{
    options: any;
}>();

const bookingModal = ref<any>(null);
const { currentOptions, isLoggedIn, isShareBooking, restoreLoginState, importBookingLink } = useBookingImport(props);

const initBooking = () => {
    restoreLoginState();
    currentOptions.value = props.options || {};
    setTimeout(() => {
        if (bookingModal.value) {
            bookingModal.value.open(currentOptions.value);
        }
    }, 50);
};

onMounted(() => {
    initBooking();
});

watch(() => props.options, () => {
    initBooking();
}, { deep: true });

const handleBookingSuccess = async () => {
    await importBookingLink();
    if (isLoggedIn.value) {
        uni.reLaunch({ url: '/pages/library/index' });
        return;
    }
    goBack();
};

const goBack = () => {
    if (isShareBooking.value) {
        if (isLoggedIn.value) {
            uni.reLaunch({ url: '/pages/library/index' });
            return;
        }
        uni.reLaunch({ url: '/pages/index/index' });
        return;
    }
    const pages = getCurrentPages();
    if (pages.length > 1) {
        uni.navigateBack();
        return;
    }
    if (isLoggedIn.value) {
        uni.reLaunch({ url: '/pages/user/profile' });
        return;
    }
    uni.reLaunch({ url: '/pages/login/login' });
};
</script>

<style lang="scss" scoped>
.booking-content-wrapper {
    padding: 0;
}
</style>
