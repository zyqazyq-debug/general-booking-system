import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useServiceStore = defineStore('service', () => {
  const services = ref<any[]>([]);
  const lastFetchTime = ref(0);
  const CACHE_TTL = 300000;

  const setServices = (newList: any[]) => {
    services.value = newList;
    lastFetchTime.value = Date.now();
  };

  const clear = () => {
    services.value = [];
    lastFetchTime.value = 0;
  };

  const invalidate = () => {
    lastFetchTime.value = 0;
  };

  const isStale = () => {
    return Date.now() - lastFetchTime.value > CACHE_TTL;
  };

  return {
    services,
    lastFetchTime,
    CACHE_TTL,
    setServices,
    clear,
    invalidate,
    isStale
  };
});
