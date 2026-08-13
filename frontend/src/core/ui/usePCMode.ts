import { ref, onMounted, onUnmounted, computed } from 'vue';

const windowWidth = ref(0);

if (typeof window !== 'undefined') {
  windowWidth.value = window.innerWidth;
} else {
  try {
    const info = uni.getSystemInfoSync();
    windowWidth.value = info.windowWidth;
  } catch (e) {
    // ignore
  }
}

const updateWidth = () => {
  try {
    const info = uni.getSystemInfoSync();
    windowWidth.value = info.windowWidth;
  } catch (e) {
    if (typeof window !== 'undefined') {
      windowWidth.value = window.innerWidth;
    }
  }
};

export function usePCMode() {
  onMounted(() => {
    updateWidth();
    uni.onWindowResize(updateWidth);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateWidth);
    }
  });

  onUnmounted(() => {
    uni.offWindowResize(updateWidth);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', updateWidth);
    }
  });

  const isPC = computed(() => windowWidth.value >= 768);

  return {
    isPC,
    windowWidth,
  };
}
