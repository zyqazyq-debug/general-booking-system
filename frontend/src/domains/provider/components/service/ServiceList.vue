<template>
  <view class="service-list">
    <view v-if="services.length === 0" class="empty-state-mini">
      <text class="icon">📝</text>
      <text>暂无服务，可新建服务并分享给他人</text>
    </view>
    
    <view v-else class="service-list-content">
      <view v-for="item in services" :key="item.id" class="service-item">
        <view class="item-left">
          <view class="info-box">
            <text class="service-title">{{ item.title || '（无标题）' }}</text>
            <view class="price-duration-row">
                <text class="service-price">¥{{ item.base_price }}</text>
                <text class="service-duration">{{ item.duration_minutes }}分钟</text>
            </view>
          </view>
        </view>
        <view class="item-right">
          <view class="switch-wrap" @click.stop="onToggleWrapper(item)">
              <switch :checked="item.is_active" :disabled="true" color="#28a745" style="transform:scale(0.7); pointer-events: none;" />
          </view>
          
          <view class="action-chip" @click.stop="onShare(item)">
            <text>分享</text>
          </view>

          <view class="action-chip" @click.stop="onEdit(item.id)">
            <text>编辑</text>
          </view>
          <view class="action-chip action-chip--danger" @click.stop="onDelete(item.id)">
            <text>🗑️</text>
          </view>
        </view>
      </view>
    </view>
   </view>
 </template>
 
 <script setup lang="ts">
 
 const props = defineProps<{
   services: any[]
 }>();
 
const emit = defineEmits(['toggle-active', 'share', 'edit', 'delete']);

const onToggleWrapper = (item: any) => {
    emit('toggle-active', item);
};

const onShare = (item: any) => {
  emit('share', item);
};

const onEdit = (id: string) => {
  emit('edit', id);
};

const onDelete = (id: string) => {
  console.log('[ServiceList] onDelete triggered for id:', id);
  emit('delete', id);
};
</script>

<style lang="scss" scoped>
@use '@/styles/action-button.scss' as actionButton;

.service-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
}

.service-list-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
}

.service-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    column-gap: 8px;
    border-bottom: 1px solid $uni-bg-color-grey;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
}

.service-item:last-child {
    border-bottom: none;
}

.service-item:active {
    background-color: $uni-bg-color-hover;
}

.item-left {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
    overflow: hidden;
}

.info-box {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    margin-left: 4px;
    overflow: hidden;
}

.service-title {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    color: $uni-text-color-secondary;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.price-duration-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
}

.service-price {
    font-size: 14px;
    color: $uni-color-primary;
    font-weight: 600;
    display: inline-block;
    white-space: nowrap;
}

.service-duration {
    font-size: 11px;
    color: $uni-text-color-placeholder;
    align-self: flex-end;
    margin-top: 1px;
    white-space: nowrap;
}

.item-right {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 4px;
    flex: 0 0 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
}

.switch-wrap {
    flex: 0 0 auto;
    white-space: nowrap;
}

.action-chip {
    @include actionButton.action-chip-button;
}

.action-chip:active {
    @include actionButton.action-chip-button-active;
}

.action-chip--danger {
    border-color: #fee2e2;
    color: $uni-color-error;
}
</style>
