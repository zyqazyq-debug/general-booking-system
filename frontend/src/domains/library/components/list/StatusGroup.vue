<template>
  <AppCard :no-margin="true" class="status-group-card">
    <template #header>
        <view class="status-group-header" @click="toggle">
            <view class="status-group-left">
                <text class="status-group-title">{{ group.title }}</text>
                <text class="status-group-count">{{ group.items.length }}</text>
            </view>
            <view class="status-group-right" @click.stop>
                <picker mode="selector" :range="pageSizeOptions" :value="pageSizeIndex" @change="onPageSizeChange" @click.stop>
                    <view class="group-page-size">{{ pageSize }}条/页</view>
                </picker>
                <view class="group-page-nav" @click.stop>
                    <input
                        class="group-page-input"
                        type="number"
                        :value="pageInput"
                        @input="onPageInput"
                        @blur="applyPageInput"
                        @confirm="applyPageInput"
                    />
                    <text class="group-page-indicator">/{{ totalPages }}页</text>
                </view>
                <view class="status-toggle" @click.stop="toggle">
                    <text class="toggle-text">{{ expanded ? '收起' : '展开' }}</text>
                    <text class="status-group-arrow">{{ expanded ? '▾' : '▸' }}</text>
                </view>
            </view>
        </view>
    </template>
    
    <view v-show="expanded" class="status-group-body">
        <view v-if="group.items.length === 0" class="group-empty">{{ group.emptyText }}</view>
        <view class="service-items-list">
            <ServiceCard 
                v-for="item in pageItems" 
                :key="item.id" 
                :item="item" 
                :availability-status="availabilityMap[item.id]"
            />
        </view>
    </view>
  </AppCard>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import AppCard from '@/components/AppCard.vue';
import ServiceCard from './ServiceCard.vue';
import { useLibraryListContext } from './composables/useLibraryListContext';

const { pageSizeOptions, pageSize: defaultPageSizeRef, availabilityMap } = useLibraryListContext();

const props = defineProps<{
    group: {
        key: string,
        title: string,
        items: any[],
        emptyText: string
    },
    expanded: boolean
}>();

const emit = defineEmits(['update:expanded']);

const pageSize = ref(defaultPageSizeRef.value);
const currentPage = ref(1);
const pageInput = ref(String(currentPage.value));

const totalPages = computed(() => {
    const count = props.group.items.length || 0;
    const total = Math.ceil(count / pageSize.value);
    return Math.max(total, 1);
});

const pageSizeIndex = computed(() => {
    const idx = pageSizeOptions.indexOf(pageSize.value);
    return idx > -1 ? idx : 0;
});

const pageItems = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return props.group.items.slice(start, start + pageSize.value);
});

const toggle = () => {
    emit('update:expanded', !props.expanded);
};

const syncPageInput = () => {
    pageInput.value = String(currentPage.value);
};

const setCurrentPage = (page: number) => {
    const safePage = Math.min(Math.max(page, 1), totalPages.value);
    currentPage.value = safePage;
    syncPageInput();
};

const onPageInput = (e: any) => {
    pageInput.value = String(e?.detail?.value ?? '');
};

const applyPageInput = () => {
    const parsed = Number.parseInt(pageInput.value, 10);
    if (Number.isNaN(parsed)) {
        syncPageInput();
        return;
    }
    setCurrentPage(parsed);
};

const onPageSizeChange = (e: any) => {
    const index = Number(e?.detail?.value ?? 0);
    pageSize.value = pageSizeOptions[index] || defaultPageSizeRef.value;
    defaultPageSizeRef.value = pageSize.value;
    setCurrentPage(1);
};

watch(() => props.group.items, () => {
    if (currentPage.value > totalPages.value) {
        setCurrentPage(1);
        return;
    }
    syncPageInput();
});

watch(currentPage, () => {
    syncPageInput();
});
</script>

<style lang="scss" scoped>
:deep(.app-card__header) {
    padding: 0;
    display: block;
}

.status-group-header {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 12px;
    overflow: hidden;
    white-space: nowrap;
    width: 100%;
    box-sizing: border-box;
}

.status-group-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.status-group-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
}

.status-group-title {
    font-size: $uni-font-size-h2;
    font-weight: $uni-font-weight-bold;
    color: $uni-text-color;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.status-group-count {
    min-width: 20px;
    padding: 0 6px;
    height: 20px;
    line-height: 20px;
    text-align: center;
    font-size: 12px;
    color: $uni-color-primary;
    background: $uni-color-primary-light;
    border-radius: 10px;
    font-weight: 600;
    flex: 0 0 auto;
}

.status-toggle {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 0 4px 4px;
    flex: 0 0 auto;
    white-space: nowrap;
}

.toggle-text {
    font-size: 12px;
    color: $uni-text-color-grey;
}

.status-group-arrow {
    font-size: 14px;
    color: $uni-text-color-grey;
}

.group-page-size {
    height: 24px;
    line-height: 24px;
    border: 1px solid $uni-border-color;
    border-radius: 6px;
    padding: 0 6px;
    font-size: 11px;
    color: $uni-text-color;
    background: $uni-bg-color-grey;
    white-space: nowrap;
    flex: 0 0 auto;
}

.group-page-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
    white-space: nowrap;
}

.group-page-input {
    width: 32px;
    height: 24px;
    line-height: 24px;
    padding: 0 4px;
    border: 1px solid $uni-border-color;
    border-radius: 6px;
    background: #fff;
    text-align: center;
    font-size: 11px;
    color: $uni-text-color;
    box-sizing: border-box;
}

.group-page-indicator {
    font-size: 11px;
    color: $uni-text-color-grey;
    text-align: center;
    white-space: nowrap;
    flex: 0 0 auto;
}

.status-group-body {
    padding: 0;
}

.service-items-list {
    display: flex;
    flex-direction: column;
}

.group-empty {
    text-align: center;
    color: $uni-text-color-placeholder;
    font-size: 13px;
    padding: 24px 0;
}
</style>
