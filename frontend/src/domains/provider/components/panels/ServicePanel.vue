<template>
    <view class="dashboard-page panel-content">
        <view v-if="isRefreshing" class="refresh-tip">刷新中...</view>
        <AppCard :no-margin="true" custom-class="top-unified-card">
            <view class="quick-actions">
                <AppButton type="primary" size="medium" class="quick-action" @click="handleCreate">新建服务</AppButton>
                <AppButton type="primary" size="medium" class="quick-action" @click="openScheduleModal">休息设置</AppButton>
                <AppButton type="primary" outline size="medium" class="quick-action" @click="handleManualRefresh">刷新</AppButton>
            </view>
        </AppCard>

        <DashboardCard :title="'我的服务'" :padding="'0'" :no-margin="true">
            <view v-if="isRefreshing && !hasLoadedOnce" class="panel-skeleton">
                <view class="skeleton-row" />
                <view class="skeleton-row" />
                <view class="skeleton-row" />
            </view>
            <ServiceList
                v-else
                :services="services"
                @toggle-active="handleToggleActive"
                @share="handleShare"
                @edit="handleEdit"
                @delete="deleteServiceItem"
            />
        </DashboardCard>

        <!-- Visual Schedule -->
        <DashboardCard :title="'收藏日程'" :padding="'12px'" :no-margin="true">
            <!-- Header Actions Slot -->
            <template #action>
                <!-- We can move the view toggle here if desired, but for now keeping it in Schedule is simpler -->
            </template>
            
            <view v-if="isRefreshing && !hasLoadedOnce" class="panel-skeleton panel-skeleton--schedule">
                <view class="skeleton-chip" />
                <view class="skeleton-row" />
                <view class="skeleton-row" />
                <view class="skeleton-row" />
            </view>
            <Schedule
                v-else
                :view-mode="viewMode"
                :selected-date="selectedDate"
                :weekly-orders="weeklyOrders"
                :todays-orders="todaysOrders"
                @toggle-view-mode="toggleViewMode"
                @prev-week="onPrevWeek"
                @next-week="onNextWeek"
                @prev-day="onPrevDay"
                @next-day="onNextDay"
                @date-change="onDateChange"
                @slot-click="onSlotClick"
            />
        </DashboardCard>

        <ServiceEditModal
            v-model:visible="showServiceModal"
            :service-id="currentEditingServiceId || undefined"
            @saved="onModalRefresh"
        />

        <!-- Share Modal -->
        <ShareModal
          v-model:visible="showShareModal"
          :share-link="currentShareLink"
          :share-title="currentShareTitle"
          :share-text="currentShareText"
          :share-summary="currentShareSummary"
          :share-wake-tip="currentShareWakeTip"
        />

        <!-- Service Block Form Modal -->
        <ServiceBlockForm 
            v-model:visible="showBlockModal"
            :service-id="blockServiceId"
            @success="onBlockSuccess"
        />

        <AppModal v-model:visible="showOrderDetailModal" title="订单详情">
            <OrderDetailComponent :order-id="selectedOrderId" role="PROVIDER" />
        </AppModal>
    </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import AppCard from '@/shared/components/AppCard.vue';
import AppButton from '@/shared/components/AppButton.vue';
import DashboardCard from '@/shared/components/DashboardCard.vue';
import AppModal from '@/shared/components/AppModal.vue';
// Note: Adjusted import paths since we are now in src/components/panels/
import ShareModal from '@/shared/components/ShareModal.vue';
import { OrderDetailComponent } from '@/domains/order';
import { useServiceStore } from '../../stores/service';
import ServiceList from '../service/ServiceList.vue';
import ServiceEditModal from '../service/ServiceEditModal.vue';
import Schedule from '../stats/Schedule.vue';
import ServiceBlockForm from '../ServiceBlockForm.vue';
import { useDashboardServices } from '../../composables/useDashboardServices';
import { useDashboardSchedule } from '../../composables/useDashboardSchedule';

const userStore = useUserStore();
const serviceStore = useServiceStore();

// --- Composable: Services ---
const {
  services,
  showServiceModal,
  loadServices,
  toggleActive,
  openEditModal,
  openCreateModal,
  onModalRefresh,
  deleteServiceItem,
  shareService,
  showShareModal,
  currentShareLink,
  currentShareTitle,
  currentShareText,
  currentShareSummary,
  currentShareWakeTip
} = useDashboardServices();

// --- Composable: Schedule ---
const {
    viewMode,
    selectedDate,
    weeklyOrders,
    todaysOrders,
    loadWeeklyOrders,
    loadTodaysOrders,
    toggleViewMode,
    onDateChange,
    onPrevWeek,
    onNextWeek,
    onPrevDay,
    onNextDay
} = useDashboardSchedule();

const currentEditingServiceId = ref<string>('');

// --- Block Logic ---
const showBlockModal = ref(false);
const blockServiceId = ref<string | undefined>('');

const openScheduleModal = () => {
  blockServiceId.value = undefined; // Signal global
  showBlockModal.value = true;
};

const onBlockSuccess = () => {
    if (viewMode.value === 'week') loadWeeklyOrders();
    else loadTodaysOrders();
};

const handleEdit = (id: string) => {
  currentEditingServiceId.value = id;
  openEditModal(id);
};

const handleToggleActive = async (item: any) => {
  await toggleActive(item);
};

const handleShare = async (item: any) => {
  await shareService(item);
};

const handleCreate = () => {
  currentEditingServiceId.value = '';
  openCreateModal();
};

const handleManualRefresh = async () => {
  await refresh(true);
  uni.showToast({ title: '已刷新', icon: 'none' });
};

// --- Order Detail Popup ---
const showOrderDetailModal = ref(false);
const selectedOrderId = ref('');
let currentRefreshPromise: Promise<void> | null = null;
const isRefreshing = ref(false);
const hasLoadedOnce = ref(false);
let lastVisibilityRefreshAt = 0;

// Auto-refresh when store is invalidated
watch(
  () => serviceStore.lastFetchTime,
  (newVal, oldVal) => {
    if (newVal === 0 && oldVal !== 0) {
      refresh(false);
    }
  },
);

const onSlotClick = (payload: any) => {
    if (typeof payload === 'object' && payload.date) {
        selectedDate.value = payload.date;
        viewMode.value = 'day';
    } else if (typeof payload === 'object' && payload.id) {
        selectedOrderId.value = payload.id;
        showOrderDetailModal.value = true;
    }
};

const refresh = async (force = false) => {
  if (currentRefreshPromise) return currentRefreshPromise;
  if (!userStore.userInfo) return;

  currentRefreshPromise = (async () => {
    try {
      isRefreshing.value = true;
      await loadServices(force);
      // loadWeeklyOrders (alias for ensureDataLoaded) supports force
      await loadWeeklyOrders(force);
    } finally {
      hasLoadedOnce.value = true;
      isRefreshing.value = false;
      currentRefreshPromise = null;
    }
  })();
  
  return currentRefreshPromise;
};

onMounted(() => {
    refresh(false);

    // Visibility change listener for H5/Browser
    if (typeof window !== 'undefined') {
        window.addEventListener('visibilitychange', onVisibilityChange);
    }
});

const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastVisibilityRefreshAt < 1000) return;
        lastVisibilityRefreshAt = now;
        refresh(false);
    }
};

onUnmounted(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', onVisibilityChange);
    }
});

defineExpose({
    refresh
});
</script>

<style lang="scss" scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  /* Removed overflow: hidden to allow scrolling within parent */
}

.refresh-tip {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: $uni-text-color-placeholder;
}

.panel-skeleton {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel-skeleton--schedule {
  padding: 0;
}
.skeleton-row,
.skeleton-chip {
  border-radius: 10px;
  background: linear-gradient(90deg, rgba(220,220,220,0.55) 25%, rgba(235,235,235,0.9) 37%, rgba(220,220,220,0.55) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}
.skeleton-row {
  height: 46px;
}
.skeleton-chip {
  height: 20px;
  width: 120px;
}
@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

.quick-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: nowrap;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.quick-actions .quick-action {
  flex: 1 1 0;
  width: 0;
  min-width: 0;
}
</style>
