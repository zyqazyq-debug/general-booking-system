import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AgencyCollectionNode } from '@/types/api';

export const useLibraryStore = defineStore('library', () => {
  const list = ref<AgencyCollectionNode[]>([]);
  const lastFetchTime = ref(0);
  const CACHE_TTL = 300000;

  const setList = (newList: AgencyCollectionNode[]) => {
    list.value = newList;
    lastFetchTime.value = Date.now();
  };

  const clear = () => {
    list.value = [];
    lastFetchTime.value = 0;
  };

  const invalidate = () => {
    lastFetchTime.value = 0;
  };

  const isStale = () => {
    return Date.now() - lastFetchTime.value > CACHE_TTL;
  };

  return {
    list,
    lastFetchTime,
    CACHE_TTL,
    setList,
    clear,
    invalidate,
    isStale
  };
});
