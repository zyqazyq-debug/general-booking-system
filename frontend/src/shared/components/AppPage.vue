<template>
  <view 
    class="app-page"
    :class="{ 'app-page--with-tabbar': withTabbar, 'app-page--with-navbar': withNavbar }"
    :style="customStyle"
  >
    <!-- Global Confirm Host injected here for reliability -->
    <AppConfirmHost />

    <view v-if="withNavbar" class="app-navbar" :style="{ paddingTop: statusBarHeight + 'px' }">
        <view class="app-navbar__content">
            <view class="app-navbar__left" @click="handleBack">
                <slot name="nav-left">
                    <text v-if="showBack" class="back-icon">←</text>
                </slot>
            </view>
            <view class="app-navbar__title">
                <text>{{ title }}</text>
            </view>
            <view class="app-navbar__right">
                <slot name="nav-right"></slot>
            </view>
        </view>
    </view>
    
    <scroll-view 
        class="app-page__content app-page__content--hide-scrollbar" 
        :scroll-y="enableScroll"
        @scroll="onScroll"
        @scrolltolower="onScrollToLower"
    >
        <view class="content-wrapper" :style="{ padding: padding }">
            <slot></slot>
        </view>
        <!-- Spacer removed, handled by flex layout -->
    </scroll-view>
    
    <view v-if="showScrollHint" class="scroll-hint" @click.stop>
        <text class="hint-icon">↓</text>
    </view>
    
    <slot name="tabbar"></slot>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, getCurrentInstance } from 'vue';
import AppConfirmHost from '@/components/AppConfirmHost.vue';

interface Props {
    title?: string;
    withTabbar?: boolean;
    withNavbar?: boolean;
    showBack?: boolean;
    padding?: string;
    customStyle?: any;
    customBack?: boolean;
    disablePageScroll?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    title: '',
    withTabbar: false,
    withNavbar: false,
    showBack: true,
    padding: '8px',
    customStyle: {},
    customBack: false,
    disablePageScroll: false
});

const emit = defineEmits(['back', 'scrolltolower']);
const statusBarHeight = ref(0);
const enableScroll = computed(() => !props.disablePageScroll);
const showScrollHint = ref(false); // Default false, only show if scrollable

const checkScrollable = () => {
    // Similar to AppModal logic
    showScrollHint.value = false;
    
    // Use simple timeout to allow render
    setTimeout(() => {
        const instance = getCurrentInstance() as any;
        const scope = instance?.proxy || instance;
        const query = scope ? uni.createSelectorQuery().in(scope) : uni.createSelectorQuery();
        query.select('.app-page__content').boundingClientRect();
        query.select('.content-wrapper').boundingClientRect();
        query.exec((res: any[]) => {
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
                showScrollHint.value = true;
            }
        });
    }, 300);
};

onMounted(() => {
    const sysInfo = uni.getSystemInfoSync();
    statusBarHeight.value = sysInfo.statusBarHeight || 0;
    
    if (enableScroll.value) {
        checkScrollable();
    }
});

const handleBack = () => {
    if (props.showBack) {
        if (props.customBack) {
            emit('back');
        } else {
            uni.navigateBack();
            emit('back');
        }
    }
};

const onScroll = () => {
    // Optional: Hide hint on scroll? 
    // Requirement: "只要有滚动范围就出现，而不是滚动后消失" -> Suggests it stays until bottom?
    // Or maybe it means "If there is scroll range, show it. Don't auto-hide after some time."
    // But usually we hide it when user reaches bottom.
};

const onScrollToLower = (e: any) => {
    showScrollHint.value = false;
    emit('scrolltolower', e);
};

defineExpose({ checkScrollable });
</script>

<style lang="scss" scoped>
.app-page {
    height: 100dvh;
    height: calc(var(--app-vh, 1vh) * 100);
    overflow: hidden;
    background-color: $uni-bg-color-grey;
    display: flex;
    flex-direction: column;
    position: relative;
    box-sizing: border-box;
    
    &__content {
        flex: 1;
        height: 0;
        width: 100%;
        box-sizing: border-box;
        overflow: hidden;
    }
}

:deep(::-webkit-scrollbar) {
    display: none;
    width: 0 !important;
    height: 0 !important;
    -webkit-appearance: none;
    background: transparent;
}

.app-page__content--hide-scrollbar {
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.app-page__content--hide-scrollbar::-webkit-scrollbar {
    display: none;
    width: 0 !important;
    height: 0 !important;
    -webkit-appearance: none;
    background: transparent;
}

.content-wrapper {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
}

.app-navbar {
    position: relative;
    flex-shrink: 0;
    z-index: $uni-z-navbar;
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid $uni-border-color-light;
    
    &__content {
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
    }

    &__title {
        font-size: 17px;
        font-weight: 600;
        color: $uni-text-color;
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
    }
    
    &__left, &__right {
        min-width: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .back-icon {
        font-size: 24px;
        color: $uni-text-color;
    }
}

/* tabbar-spacer removed */

.scroll-hint {
    position: absolute;
    bottom: 80px; /* Position above tabbar (60px + safe area approx) */
    left: 50%;
    transform: translateX(-50%);
    z-index: $uni-z-float;
    pointer-events: none;
    opacity: 0.6;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(0, 0, 0, 0.3);
    width: 32px;
    height: 32px;
    border-radius: $uni-radius-circle;
}

.hint-icon {
    font-size: 18px;
    color: $uni-bg-color;
    line-height: 1;
}
</style>
