<template>
  <view class="service-list">
    <EmptyState
      v-if="filteredList.length === 0"
      :message="list.length === 0 ? '收藏列表为空' : '无匹配结果'"
      :show-button="list.length === 0"
      button-text="去浏览"
      @action="emit('go-back')"
    />

    <view v-else class="status-groups">
      <StatusGroup
        v-for="group in collectionGroups"
        :key="group.key"
        :group="group"
        :expanded="expandedGroups[group.key]"
        @update:expanded="emit('update-expanded', group.key, $event)"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import EmptyState from './EmptyState.vue';
import StatusGroup from './StatusGroup.vue';

defineProps<{
  list: any[];
  filteredList: any[];
  collectionGroups: any[];
  expandedGroups: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: 'update-expanded', key: string, value: boolean): void;
  (e: 'go-back'): void;
}>();
</script>
