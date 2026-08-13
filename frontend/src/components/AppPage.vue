<template>
  <SharedAppPage v-bind="$attrs">
    <template v-if="$slots['nav-left']" #nav-left>
      <slot name="nav-left"></slot>
    </template>
    <template v-if="$slots['nav-right']" #nav-right>
      <slot name="nav-right"></slot>
    </template>
    <template v-if="$slots.tabbar" #tabbar>
      <slot name="tabbar"></slot>
    </template>
    <slot></slot>
  </SharedAppPage>
</template>

<script setup lang="ts">
import SharedAppPage from '@/shared/components/AppPage.vue';
</script>
