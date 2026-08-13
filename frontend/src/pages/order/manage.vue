<template>
  <OrderListImpl
    tab="PROVIDER"
    :hide-tabs="true"
    initial-id=""
    scene="provider-manage"
    title="订单管理"
    :with-tabbar="false"
  />
</template>

<script setup lang="ts">
import { OrderListImpl } from '@/domains/order';
</script>
