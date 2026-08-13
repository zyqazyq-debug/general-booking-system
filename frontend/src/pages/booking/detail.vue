<template>
    <BookingDetailImpl :options="routeOptions" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { BookingDetailImpl } from '@/domains/booking';

const routeOptions = ref<any>({});

onLoad((options: any) => {
    routeOptions.value = options || {};
});
</script>
