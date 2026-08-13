<template>
  <view 
    class="app-card" 
    :class="[
      { 'app-card--bordered': bordered },
      { 'app-card--shadow': shadow },
      { 'app-card--no-margin': noMargin },
      customClass
    ]"
    :style="customStyle"
    @click="handleClick"
  >
    <view v-if="$slots.header || title" class="app-card__header">
        <slot name="header">
            <text class="app-card__title">{{ title }}</text>
            <view class="app-card__extra">
                <slot name="extra"></slot>
                <slot name="action"></slot>
            </view>
        </slot>
    </view>
    
    <view class="app-card__body" :style="{ padding: padding }">
        <slot></slot>
    </view>
    
    <view v-if="$slots.footer" class="app-card__footer">
        <slot name="footer"></slot>
    </view>
  </view>
</template>

<script setup lang="ts">
defineSlots<{
    default?: () => any;
    header?: () => any;
    extra?: () => any;
    action?: () => any;
    footer?: () => any;
}>();

interface Props {
    title?: string;
    bordered?: boolean;
    shadow?: boolean;
    padding?: string;
    customClass?: string;
    customStyle?: any;
    noMargin?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    title: '',
    bordered: true, // Default to bordered in this system
    shadow: true,   // Default to shadow
    padding: '8px 12px',
    customClass: '',
    customStyle: {},
    noMargin: false
});

const emit = defineEmits(['click']);

const handleClick = (e: any) => {
    emit('click', e);
};
</script>

<style lang="scss" scoped>
.app-card {
    background-color: $uni-bg-color;
    border-radius: $uni-radius-lg; /* 12px */
    overflow: hidden;
    margin-bottom: 12px; /* Reduced from 16px */
    transition: all 0.2s;
    
    &--bordered {
        border: 1px solid $uni-border-color;
    }
    
    &--shadow {
        box-shadow: $uni-shadow-sm;
    }

    &--no-margin {
        margin-bottom: 0 !important;
    }
    
    &__header {
        padding: 6px 12px;
        border-bottom: 1px solid $uni-border-color-light;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: $uni-bg-color-hover; /* Slight contrast for header */
    }
    
    &__title {
        font-size: $uni-font-size-h2; /* 16px */
        font-weight: $uni-font-weight-bold;
        color: $uni-text-color;
    }
    
    &__extra {
        display: flex;
        align-items: center;
    }
    
    &__body {
        /* Padding controlled by prop */
    }
    
    &__footer {
        padding: 6px 12px;
        border-top: 1px solid $uni-border-color-light;
    }
}
</style>
