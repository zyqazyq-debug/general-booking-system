<template>
  <SharedAppModal v-bind="$attrs">
    <slot></slot>
    <template v-if="$slots.footer" #footer>
      <slot name="footer"></slot>
    </template>
  </SharedAppModal>
</template>

<script setup lang="ts">
import SharedAppModal from '@/shared/components/AppModal.vue';

defineSlots<{
  default?: () => any;
  footer?: () => any;
}>();
</script>
