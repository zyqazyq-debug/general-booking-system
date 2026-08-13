<template>
  <SharedShareModal v-bind="forwarded">
    <slot></slot>
  </SharedShareModal>
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import SharedShareModal from '@/shared/components/ShareModal.vue';

const props = defineProps<{
  visible: boolean;
  shareLink: string;
  shareTitle?: string;
  shareText?: string;
  shareSummary?: {
    name: string;
    price: string;
    duration: string;
  } | null;
  shareWakeTip?: string;
}>();

const attrs = useAttrs();
const forwarded = computed(() => ({ ...attrs, ...props }));
</script>
