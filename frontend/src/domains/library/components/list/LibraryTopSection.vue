<template>
  <AppCard :no-margin="true" custom-class="top-unified-card">
    <FilterPanel
      :keyword="keyword"
      :show-filter="showFilter"
      :filter-price="filterPrice"
      :filter-date="filterDate"
      @update:keyword="emit('update:keyword', $event)"
      @update:show-filter="emit('update:showFilter', $event)"
      @update:filter-price="emit('update:filterPrice', $event)"
      @update:filter-date="emit('update:filterDate', $event)"
      @import="emit('import')"
      @refresh="emit('refresh')"
      @reset="emit('reset')"
      @setting="emit('setting')"
    />
  </AppCard>
</template>

<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
import FilterPanel from './FilterPanel.vue';

defineProps<{
  keyword: string;
  showFilter: boolean;
  filterPrice: { min: string; max: string };
  filterDate: { date: string };
}>();

const emit = defineEmits<{
  (e: 'update:keyword', value: string): void;
  (e: 'update:showFilter', value: boolean): void;
  (e: 'update:filterPrice', value: { min: string; max: string }): void;
  (e: 'update:filterDate', value: { date: string }): void;
  (e: 'import'): void;
  (e: 'refresh'): void;
  (e: 'reset'): void;
  (e: 'setting'): void;
}>();
</script>
