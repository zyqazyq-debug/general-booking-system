<template>
  <AppPage
    :title="pageTitle"
    :with-navbar="true"
    :with-tabbar="showTabbar"
    :show-back="hideTabs"
    :padding="PAGE_SHELL_PADDING"
  >
    <OrderListComponent
      :tab="tab"
      :hide-tabs="hideTabs"
      :initial-id="initialId"
      :scene="scene"
      @order-click="onOrderClick"
    />

    <template #tabbar>
      <AppTabBar v-if="showTabbar" />
    </template>
  </AppPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppPage from '@/shared/components/AppPage.vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { PAGE_SHELL_PADDING } from '@/constants/layout-shell';
import { getOrderListTitle } from '../composables/useOrderScene';
import OrderListComponent from '../components/OrderListComponent.vue';

const props = defineProps<{
  tab: string;
  hideTabs: boolean;
  initialId: string;
  scene?: 'default' | 'provider-manage';
  title?: string;
  withTabbar?: boolean;
}>();

const pageTitle = computed(() =>
  getOrderListTitle({
    tab: props.tab,
    hideTabs: props.hideTabs,
    title: props.title,
  }),
);

const showTabbar = computed(() => props.withTabbar ?? !props.hideTabs);

const onOrderClick = (payload: { id: string; role: string }) => {
  uni.navigateTo({
    url: `/pages/order/detail?id=${payload.id}&role=${payload.role}`,
  });
};
</script>
