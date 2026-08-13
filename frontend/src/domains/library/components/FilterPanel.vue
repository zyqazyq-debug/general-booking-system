<template>
  <view class="filter-bar-sticky">
    <view class="toolbar-row">
      <view class="tool-actions">
        <view class="tool-chip" @click="onImport">
          <text class="tool-icon">📥</text>
          <text class="tool-label">导入</text>
        </view>
        <view class="tool-chip" :class="{active: showFilter}" @click="toggleFilter">
          <text class="tool-icon">⚡</text>
          <text class="tool-label">筛选</text>
        </view>
        <view class="tool-chip" @click="onRefresh">
          <text class="tool-icon">🔄</text>
          <text class="tool-label">刷新</text>
        </view>
      </view>

      <view class="search-input-wrap">
        <input class="search-input" :value="keyword" placeholder="搜索服务..." confirm-type="search" @confirm="onSearch" @input="onInput" />
      </view>
    </view>

    <!-- Filter Options Panel -->
    <view v-if="showFilter" class="filter-panel">
      <view class="filter-row">
        <text class="filter-label">价格范围</text>
        <view class="filter-inputs">
          <input type="number" class="filter-field filter-input" :value="filterPrice.min" placeholder="最低价" @input="updatePrice('min', $event)" />
          <text class="separator">-</text>
          <input type="number" class="filter-field filter-input" :value="filterPrice.max" placeholder="最高价" @input="updatePrice('max', $event)" />
        </view>
      </view>
      <view class="filter-row mt-2">
        <text class="filter-label">查询可用日期</text>
        <view class="datetime-grid">
          <view class="datetime-col">
            <picker class="datetime-picker" mode="date" :value="filterDate.date" @change="updateDate('date', $event)">
              <view :class="['filter-field', 'picker-input', !filterDate.date && 'picker-placeholder']">{{ filterDate.date || '选择查询日期' }}</view>
            </picker>
          </view>
        </view>
      </view>
      <view class="filter-actions mt-3">
        <AppButton type="info" outline size="small" block @click="resetFilter">重置筛选</AppButton>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppButton from '@/components/AppButton.vue';



const props = defineProps<{
  keyword: string,
  showFilter: boolean,
  filterPrice: { min: string, max: string },
  filterDate: { date: string }
}>();

const emit = defineEmits([
  'update:keyword', 
  'update:showFilter', 
  'update:filterPrice', 
  'update:filterDate',
  'import',
  'refresh',
  'reset',
  'setting'
]);

const onInput = (e: any) => {
  emit('update:keyword', e.detail.value);
};

const onSearch = (e: any) => {
  // Can trigger explicit search if needed
};

const toggleFilter = () => {
  emit('update:showFilter', !props.showFilter);
};

const onImport = () => {
  emit('import');
};

const onRefresh = () => {
  emit('refresh');
};

const onSetting = () => {
  emit('setting');
};

const updatePrice = (field: 'min' | 'max', e: any) => {
  const newPrice = { ...props.filterPrice, [field]: e.detail.value };
  emit('update:filterPrice', newPrice);
};

const updateDate = (field: string, e: any) => {
  const newDate = { ...props.filterDate, [field]: e.detail.value };
  emit('update:filterDate', newDate);
};

const resetFilter = () => {
  emit('reset');
};
</script>

<style lang="scss" scoped>
.filter-bar-sticky {
    /* Removed sticky positioning as it's now inside a card */
    padding: 0;
}

.toolbar-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
}

.search-input-wrap {
    flex: 1;
    min-width: 0;
    height: 40px;
    display: flex;
    align-items: center;
    background-color: $uni-bg-color-grey;
    border-radius: $uni-radius-lg;
    overflow: hidden;
    padding-left: 16px;
    padding-right: 12px;
    border: 1px solid transparent;
    transition: all 0.2s;
    
    &:focus-within {
        border-color: $uni-color-primary;
        background-color: $uni-bg-color;
    }
}
.search-input {
    flex: 1;
    height: 100%;
    font-size: 14px;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0; /* Reset global margin */
    line-height: 40px; /* Match container height */
}

.tool-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

.tool-chip {
    display: grid;
    grid-template-rows: 18px 12px;
    align-content: center;
    justify-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: $uni-radius-lg;
    background-color: $uni-bg-color-hover;
}

.tool-chip:active {
    background-color: rgba(0,0,0,0.05);
}

.tool-chip.active {
    background-color: #e0f2fe;
}
.tool-chip.active .tool-label {
    color: #0284c7;
}

.tool-icon {
    font-size: 16px;
    line-height: 18px;
    min-height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.tool-label {
    font-size: 11px;
    color: $uni-text-color-secondary;
    font-weight: 700;
    line-height: 12px;
    min-height: 12px;
    letter-spacing: 0.2px;
}

.filter-panel {
    background-color: $uni-bg-color;
    border-radius: $uni-radius-lg;
    padding: 16px;
    margin-top: 10px;
    border: 1px solid $uni-border-color;
    animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
.filter-row {
    margin-bottom: 12px;
}
.filter-label {
    font-size: 13px;
    font-weight: 600;
    color: $uni-text-color-secondary;
    margin-bottom: 8px;
    display: block;
}
.filter-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
}
.datetime-grid {
    display: flex;
    align-items: stretch;
    gap: 10px;
}
.datetime-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.datetime-sep {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: $uni-text-color-placeholder;
    width: 18px;
}
.datetime-picker {
    flex: 1;
    min-width: 0;
}
.filter-field, .picker-input {
    flex: 1;
    height: 36px;
    background-color: $uni-bg-color-hover;
    border: 1px solid $uni-border-color;
    border-radius: $uni-radius-base;
    padding: 0 12px;
    font-size: 14px;
    color: $uni-text-color-secondary;
    display: flex;
    align-items: center;
}
.picker-input {
    justify-content: flex-start;
}
.picker-placeholder {
    color: $uni-text-color-placeholder;
}
.separator {
    color: #cbd5e1;
    font-weight: bold;
}
.filter-actions {
    display: flex;
    align-items: stretch;
}
.mb-3 { margin-bottom: 12px; }
.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }
.w-100 { width: 100%; }
</style>
