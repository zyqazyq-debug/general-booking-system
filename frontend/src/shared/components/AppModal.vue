<template>
  <view
    v-if="visible"
    class="app-modal-mask"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click="close"
  >
    <view
      class="app-modal-content"
      :class="[
        `size-${size}`,
        `variant-${variant}`,
        { 'center-title': centerTitle },
      ]"
      @click.stop
    >
      <view class="modal-header">
        <text class="modal-title" role="heading" aria-level="1">{{
          title
        }}</text>
        <view
          class="close-action"
          role="button"
          aria-label="关闭"
          @tap.stop="close"
          >×</view
        >
      </view>
      <scroll-view
        v-if="scrollable"
        scroll-y
        class="modal-body-scroll"
        @scroll="onScroll"
        @scrolltolower="onScrollToLower"
      >
        <view class="modal-body-wrapper">
          <slot></slot>
        </view>
      </scroll-view>
      <view v-else class="modal-body-plain">
        <slot></slot>
      </view>

      <view
        v-if="showScrollHintState && showScrollHint"
        class="scroll-hint"
        @click.stop
      >
        <text class="hint-icon">↓</text>
      </view>

      <view v-if="$slots.footer" class="modal-footer">
        <slot name="footer"></slot>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, getCurrentInstance } from 'vue';

defineSlots<{
  default?: () => any;
  footer?: () => any;
}>();

interface Props {
  visible?: boolean;
  title?: string;
  variant?: 'standard' | 'workspace';
  size?: 'sm' | 'md' | 'lg' | 'fullscreen' | 'custom';
  width?: string;
  centerTitle?: boolean;
  scrollable?: boolean;
  showScrollHint?: boolean;
  bodyPadding?: string;
  headerPadding?: string;
  headerBackground?: string;
  footerPadding?: string;
  scrollMaxHeight?: string;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  title: '',
  variant: 'standard',
  size: 'md',
  width: '',
  centerTitle: false,
  scrollable: true,
  showScrollHint: true,
  bodyPadding: '16px',
  headerPadding: '16px',
  headerBackground: 'transparent',
  footerPadding: '16px',
  scrollMaxHeight: '60vh',
});

const emit = defineEmits(['update:visible', 'close']);
const componentInstance = getCurrentInstance();
const showScrollHintState = ref(true);
const measuring = ref(false);
let measureTimer: any = null;
let measureSeq = 0;
let activeMeasureSeq = 0;
let pendingMeasure = false;

const close = () => {
  emit('update:visible', false);
  emit('close');
};

const scheduleMeasure = () => {
  if (measureTimer) {
    clearTimeout(measureTimer);
    measureTimer = null;
  }
  const seq = ++measureSeq;
  measureTimer = setTimeout(() => {
    measureTimer = null;
    doMeasure(seq);
  }, 200);
};

const doMeasure = (seq: number) => {
  pendingMeasure = false;
  if (!props.showScrollHint || !props.scrollable) {
    showScrollHintState.value = false;
    return;
  }
  // In Vue 3 + UniApp, we can't easily sync check scroll height without query
  // But we can rely on onScroll event. If it scrolls, it's scrollable.
  // If it doesn't scroll (content short), user won't see hint?
  // Actually, we want to show hint ONLY if content overflows.
  // A simple hack: set showScrollHint = false initially.
  // Use `uni.createSelectorQuery` to check content height vs container height.

  // However, since we want "初始状态如果已经都显示了，就不应该出现",
  // we MUST check dimensions.

  showScrollHintState.value = false;

  nextTick(() => {
    if (seq !== measureSeq) return;
    if (!props.visible) return;
    activeMeasureSeq = seq;
    measuring.value = true;
    setTimeout(() => {
      if (seq !== measureSeq) return;
      if (activeMeasureSeq !== seq) return;
      if (!props.visible) return;
      const instance = componentInstance as any;
      const root = instance?.proxy?.$el as HTMLElement | undefined;
      if (root && typeof root.querySelector === 'function') {
        const container = root.querySelector(
          '.modal-body-scroll',
        ) as HTMLElement | null;
        const content = root.querySelector(
          '.modal-body-wrapper',
        ) as HTMLElement | null;
        measuring.value = false;
        showScrollHintState.value = !!(
          container &&
          content &&
          content.scrollHeight > container.clientHeight
        );
        if (pendingMeasure && props.visible) scheduleMeasure();
        return;
      }
      const scope = instance?.proxy || instance;
      const query = scope
        ? uni.createSelectorQuery().in(scope)
        : uni.createSelectorQuery();
      query.select('.modal-body-scroll').boundingClientRect();
      query.select('.modal-body-wrapper').boundingClientRect();
      query.exec((res: any[]) => {
        if (seq !== measureSeq) return;
        if (activeMeasureSeq !== seq) return;
        measuring.value = false;
        if (!props.visible) return;
        const container = res?.[0];
        const content = res?.[1];
        if (
          container &&
          !Array.isArray(container) &&
          content &&
          !Array.isArray(content) &&
          typeof content.height === 'number' &&
          typeof container.height === 'number' &&
          content.height > container.height
        ) {
          showScrollHintState.value = true;
        }
        if (pendingMeasure && props.visible) {
          scheduleMeasure();
        }
      });
    }, 300); // delay for modal animation/render
  });
};

const checkScrollable = () => {
  if (!props.visible) return;
  pendingMeasure = true;
  if (measuring.value) return;
  scheduleMeasure();
};

const onScroll = () => {
  // Optional: implement logic to re-show hint if user scrolls up
};

const onScrollToLower = () => {
  showScrollHintState.value = false;
};

watch(
  () => props.visible,
  (val) => {
    if (val) {
      checkScrollable();
    } else {
      if (measureTimer) {
        clearTimeout(measureTimer);
        measureTimer = null;
      }
      measureSeq++;
      pendingMeasure = false;
      activeMeasureSeq = 0;
      measuring.value = false;
      showScrollHintState.value = false;
    }
  },
);
</script>

<style lang="scss" scoped>
.app-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: $uni-bg-color-mask;
  z-index: $uni-z-mask;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-modal-content {
  background-color: $uni-bg-color;
  border-radius: $uni-radius-lg;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: $uni-shadow-lg;
  position: relative;
  z-index: $uni-z-modal;
  max-width: 90vw;
  width: 600rpx;

  &.size-sm {
    width: 520rpx;
  }
  &.size-md {
    width: 600rpx;
  }
  &.size-lg {
    width: 680rpx;
  }
  &.size-fullscreen {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }
  &.size-custom {
    width: v-bind(width);
  }
  &.variant-workspace {
    width: $uni-modal-workspace-width;
    height: $uni-modal-workspace-height;
    max-height: $uni-modal-workspace-max-height;
    border-radius: $uni-radius-xl;
  }
  &.center-title {
    .modal-header {
      justify-content: center;
      position: relative;
    }
    .close-action {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: $uni-radius-circle;
    }
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: v-bind(headerPadding);
  background-color: v-bind(headerBackground);
  border-bottom: 1px solid $uni-border-color-light;
}

.modal-title {
  font-size: $uni-font-size-h1;
  font-weight: $uni-font-weight-bold;
  color: $uni-text-color;
}

.close-action {
  font-size: 24px;
  color: $uni-text-color-grey;
  padding: 0 $uni-spacing-xs;
  cursor: pointer;
  line-height: 1;
}

.modal-body-scroll {
  max-height: v-bind(scrollMaxHeight);
  overflow-y: auto;
}

.modal-body-wrapper {
  padding: v-bind(bodyPadding);
}

.modal-body-plain {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.app-modal-content.variant-workspace .modal-body-scroll {
  flex: 1;
  height: 0;
  max-height: none;
}

.scroll-hint {
  position: absolute;
  bottom: $uni-spacing-base;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 24px;
  background-color: rgba(255, 255, 255, 0.9);
  border-radius: $uni-radius-circle;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: $uni-shadow-sm;
  pointer-events: none;
  animation: bounce 2s infinite;
}

.hint-icon {
  font-size: 12px;
  color: $uni-color-primary;
}

.modal-footer {
  padding: v-bind(footerPadding);
  border-top: 1px solid $uni-border-color-light;
  display: flex;
  justify-content: flex-end;
  gap: $uni-spacing-sm;
}

@keyframes bounce {
  0%,
  20%,
  50%,
  80%,
  100% {
    transform: translateX(-50%) translateY(0);
  }
  40% {
    transform: translateX(-50%) translateY(-5px);
  }
  60% {
    transform: translateX(-50%) translateY(-3px);
  }
}
</style>
