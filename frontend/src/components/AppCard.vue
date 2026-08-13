<template>
  <SharedAppCard v-bind="$attrs">
    <template v-if="$slots.header" #header>
      <slot name="header"></slot>
    </template>
    <template v-if="$slots.extra" #extra>
      <slot name="extra"></slot>
    </template>
    <template v-if="$slots.action" #action>
      <slot name="action"></slot>
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer"></slot>
    </template>
    <slot></slot>
  </SharedAppCard>
</template>

<script setup lang="ts">
import SharedAppCard from '@/shared/components/AppCard.vue';

defineSlots<{
  default?: () => any;
  header?: () => any;
  extra?: () => any;
  action?: () => any;
  footer?: () => any;
}>();
</script>
