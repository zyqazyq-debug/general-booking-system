<template>
  <SharedAppButton v-bind="$attrs">
    <slot></slot>
  </SharedAppButton>
</template>

<script setup lang="ts">
import SharedAppButton from '@/shared/components/AppButton.vue';
</script>
