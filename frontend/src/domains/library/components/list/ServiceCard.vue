<template>
  <view class="service-list-item" :class="{ 'offline-item': isOffline }">
    <view class="item-content">
      <ServiceCardMainRow
        :item="item"
        :availability-status="availabilityStatus"
        :final-price="finalPrice"
        :is-offline="isOffline"
        :offline-label="statusText"
        :is-expanded="isExpanded"
        :get-availability-label="getAvailabilityLabel"
        @edit="onEdit(item.id)"
        @toggle="onToggle(item)"
        @promote="onPromote(item)"
        @book="onBook(item)"
        @toggle-expanded="toggleExpanded"
      />
      <ServiceCardDetails
        :item="item"
        :is-expanded="isExpanded"
        :is-offline="isOffline"
        :status-text="statusText"
        :time-rule="timeRule"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useLibraryDisplay } from '../../composables/useLibraryDisplay';
import { useLibraryGroups } from '../../composables/useLibraryGroups';
import ServiceCardMainRow from './components/ServiceCardMainRow.vue';
import ServiceCardDetails from './components/ServiceCardDetails.vue';
import { useLibraryListContext } from './composables/useLibraryListContext';

const props = defineProps<{
  item: any,
  availabilityStatus?: string
}>();

const { onEdit, onToggle, onPromote, onBook } = useLibraryListContext();

const isExpanded = ref(false);

const getAvailabilityLabel = (status: string) => {
    const map: Record<string, string> = {
        'available': '有空',
        'limited': '稍忙',
        'full': '约满',
        'off': '不可预约',
        'unknown': '未知'
    };
    return map[status] || '未知';
};

const {
  computeFinalPrice,
  formatTimeRule
} = useLibraryDisplay();

const {
  isCollectionOffline,
  getCollectionStatusText
} = useLibraryGroups(ref([])); 

const isOffline = computed(() => isCollectionOffline(props.item));
const statusText = computed(() => getCollectionStatusText(props.item));
const timeRule = computed(() => formatTimeRule(props.item.service));
const finalPrice = computed(() => computeFinalPrice(props.item));

const toggleExpanded = () => {
    isExpanded.value = !isExpanded.value;
};
</script>

<style lang="scss" scoped>
.service-list-item {
    background-color: #fff;
    border-bottom: 1px solid $uni-border-color-light;
    
    &:last-child {
        border-bottom: none;
    }
    
    &.offline-item {
        background-color: #f8fafc;
        
        .item-title {
            color: $uni-text-color-grey;
        }
    }
}

.item-content {
    display: flex;
    flex-direction: column;
}
</style>
