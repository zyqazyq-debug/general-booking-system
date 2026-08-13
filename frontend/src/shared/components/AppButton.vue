<template>
  <button
    class="app-button"
    :class="[
      `app-button--${type}`,
      `app-button--${size}`,
      { 'app-button--outline': outline },
      { 'app-button--block': block },
      { 'app-button--disabled': disabled || loading },
      { 'app-button--round': round }
    ]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <view class="app-button__content">
        <view v-if="loading" class="app-button__loading">
            <view class="loading-spinner"></view>
        </view>
        <slot v-else name="icon"></slot>
        <text class="app-button__text"><slot></slot></text>
    </view>
  </button>
</template>

<script setup lang="ts">
interface Props {
    type?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'text';
    size?: 'small' | 'medium' | 'large';
    outline?: boolean;
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    round?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    type: 'primary',
    size: 'medium',
    outline: false,
    block: false,
    disabled: false,
    loading: false,
    round: true
});

const emit = defineEmits(['click']);

const handleClick = (e: any) => {
    if (props.disabled || props.loading) return;
    emit('click', e);
};
</script>

<style lang="scss" scoped>
.app-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    transition: all 0.2s;
    font-weight: 500;
    line-height: 1;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    cursor: pointer;
    
    &::after {
        border: none;
    }
    
    &__content {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    
    &__text {
        white-space: nowrap;
    }
    
    &__loading {
        margin-right: 4px;
        display: flex;
        align-items: center;
    }
    
    .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    /* Sizes */
    &--small {
        height: 32px;
        padding: 0 12px;
        font-size: $uni-font-size-sm;
        
        .loading-spinner {
            width: 12px;
            height: 12px;
            border-width: 1.5px;
        }
    }
    
    &--medium {
        height: 40px;
        padding: 0 16px;
        font-size: $uni-font-size-body;
    }
    
    &--large {
        height: 48px;
        padding: 0 24px;
        font-size: $uni-font-size-h2;
    }
    
    /* Shapes */
    &--round {
        border-radius: 999px;
    }
    
    &--block {
        display: flex;
        width: 100%;
    }
    
    /* Types */
    &--primary {
        background-color: $uni-color-primary;
        color: #fff;
        
        &:active:not(.app-button--disabled) {
            background-color: $uni-color-primary-dark;
        }
        
        &.app-button--outline {
            background-color: transparent;
            border-color: $uni-color-primary;
            color: $uni-color-primary;
            
            &:active:not(.app-button--disabled) {
                background-color: $uni-color-primary-light;
            }
        }
    }
    
    &--error {
        background-color: $uni-color-error;
        color: #fff;
        
        &.app-button--outline {
            background-color: transparent;
            border-color: $uni-color-error;
            color: $uni-color-error;
        }
    }
    
    &--info {
        background-color: $uni-color-info;
        color: #fff;
        
        &.app-button--outline {
            background-color: transparent;
            border-color: $uni-border-color; 
            color: $uni-text-color-grey;
            
            &:active:not(.app-button--disabled) {
                background-color: $uni-bg-color-hover;
                border-color: $uni-text-color-placeholder;
            }
        }
    }

    &--text {
        background-color: transparent;
        color: $uni-color-primary;
        padding: 0 8px;
        height: auto;
        border: none;
        
        &:active:not(.app-button--disabled) {
            opacity: 0.7;
        }
    }
    
    /* Disabled */
    &--disabled {
        opacity: 0.6;
        cursor: not-allowed;
        pointer-events: none; /* Prevent clicks */
    }
}
</style>