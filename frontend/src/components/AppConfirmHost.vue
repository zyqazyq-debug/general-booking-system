<template>
  <SharedAppConfirmHost v-bind="$attrs">
    <slot></slot>
  </SharedAppConfirmHost>
</template>

<script setup lang="ts">
import SharedAppConfirmHost from '@/shared/components/AppConfirmHost.vue';
</script>
