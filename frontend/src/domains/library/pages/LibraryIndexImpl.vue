<template>
    <view class="content-wrapper">
        <view v-if="isLoading && !hasLoadedOnce" class="list-skeleton">
            <view class="skeleton-card" />
            <view class="skeleton-card" />
            <view class="skeleton-card" />
            <view class="skeleton-card" />
            <text class="refresh-tip">刷新中...</text>
        </view>
        <template v-else>
        <LibraryTopSection
            :keyword="keyword"
            :show-filter="showFilter"
            :filter-price="filterPrice"
            :filter-date="filterDate"
            @update:keyword="keyword = $event"
            @update:show-filter="showFilter = $event"
            @update:filter-price="filterPrice = $event"
            @update:filter-date="filterDate = $event"
            @import="showImport = true"
            @refresh="handleManualRefresh"
            @reset="resetFilter"
            @setting="onSetting"
        />
        <text v-if="isLoading" class="refresh-tip">刷新中...</text>

        <LibraryCollectionList
            :list="list"
            :filtered-list="filteredList"
            :collection-groups="collectionGroups"
            :expanded-groups="expandedGroups"
            @update-expanded="updateExpandedGroup"
            @go-back="goBack"
        />

        <ImportModal 
            v-model:visible="showImport"
            v-model:import-link="importLink"
            :import-type="importType"
            @confirm="handleImport"
            @scan="scanImport"
        />

        <ShareModal 
            :visible="showShareModal" 
            :share-link="currentShareLink" 
            :share-title="currentShareTitle"
            :share-text="currentShareText"
            :share-summary="currentShareSummary"
            :share-wake-tip="currentShareWakeTip"
            @update:visible="showShareModal = $event" 
        />

        <BatchImportModal 
            v-model:visible="showBatchImport"
            v-model:form="editForm"
            :items="importBatchList"
            @confirm="confirmBatchImport"
        />

        <EditModal 
            v-model:visible="showEdit"
            v-model:form="editForm"
            :mode="editMode"
            :preview="editPreview"
            @confirm="confirmEdit"
            @save-as-copy="confirmSaveAsCopy"
            @delete="onCollectionDeleted"
        />
        </template>
    </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/shared/stores/user';
import { useLibraryStore } from '../stores/library';
import { request } from '@/shared/api/request';
import ShareModal from '@/shared/components/ShareModal.vue';

import LibraryTopSection from '../components/list/LibraryTopSection.vue';
import LibraryCollectionList from '../components/list/LibraryCollectionList.vue';
import EditModal from '../components/edit/EditModal.vue';
import ImportModal from '../components/import/ImportModal.vue';
import BatchImportModal from '../components/import/BatchImportModal.vue';
import { provideLibraryListContext } from '../components/list/composables/useLibraryListContext';
import { useLibraryFilters } from '../composables/useLibraryFilters';
import { useLibraryGroups } from '../composables/useLibraryGroups';
import { useLibraryImport } from '../composables/useLibraryImport';
import { useLibraryEdit } from '../composables/useLibraryEdit';
import { showAppConfirm } from '@/utils/app-confirm';
import { useShare } from '@/shared/composables/useShare';
import { useBookingUnavailableGuard } from '@/shared/composables/useBookingUnavailableGuard';
import {
  onLibraryInvalidation,
  offLibraryInvalidation,
} from '@/shared/composables/useLibraryInvalidation';
import { getMyCollections, deleteDistributionCollection, updateDistributionLinkStatus } from '../api/distribution';

const props = defineProps<{
    editId?: string;
    checkScrollable?: () => void;
}>();

const userStore = useUserStore();
const libraryStore = useLibraryStore();
const list = computed(() => libraryStore.list);
const pageSizeOptions = [5, 10, 20];
const pageSize = ref(5);
const pendingEditId = ref('');
const isLoading = ref(false);
const hasLoadedOnce = ref(false);
let currentLoadPromise: Promise<void> | null = null;
let queuedForceReload = false;

const { 
  keyword, 
  showFilter, 
  filterPrice, 
  filterDate, 
  availabilityMap, 
  filteredList, 
  resetFilter 
} = useLibraryFilters(list);

const {
  expandedGroups,
  collectionGroups,
  loadGroupState,
  toggleCollectionGroup,
  isParentInactive,
  isCollectionOffline,
  getCollectionStatusText
} = useLibraryGroups(filteredList);
const {
  unavailableNodeMap,
  unavailableServiceMap,
  isBookingUnavailable,
  getBookingUnavailableMessage,
} = useBookingUnavailableGuard();

const mergedAvailabilityMap = computed<Record<string, string>>(() => {
  const nextMap: Record<string, string> = {
    ...availabilityMap.value,
  };
  Object.keys(unavailableNodeMap.value).forEach((nodeId) => {
    nextMap[nodeId] = 'off';
  });
  list.value.forEach((item: any) => {
    const serviceId = item?.service?.id;
    if (serviceId && unavailableServiceMap.value?.[serviceId]) {
      nextMap[item.id] = 'off';
    }
  });
  return nextMap;
});

// Watch for group expansion to re-check scroll hint in parent
watch(expandedGroups, () => {
    nextTick(() => {
        if (props.checkScrollable) {
            props.checkScrollable();
        }
    });
}, { deep: true });

// Auto-refresh when store is invalidated
watch(
  () => libraryStore.lastFetchTime,
  (newVal, oldVal) => {
    if (newVal === 0 && oldVal !== 0) {
      loadData(false);
    }
  },
);

const loadData = async (force = false) => {
  if (currentLoadPromise) {
    if (force) {
      queuedForceReload = true;
    }
    await currentLoadPromise;
    if (queuedForceReload) {
      queuedForceReload = false;
      return loadData(true);
    }
    return;
  }
  if (!force && libraryStore.list.length > 0 && !libraryStore.isStale()) {
    return;
  }
  
  currentLoadPromise = (async () => {
    try {
      isLoading.value = true;
      const res: any = await getMyCollections();
      
      let newList = [];
      if (Array.isArray(res)) {
          newList = res;
      } else if (res && res.data && Array.isArray(res.data)) {
          newList = res.data;
      } else {
          console.warn('Invalid collection response:', res);
      }
      libraryStore.setList(newList);
    } catch (e) {
      console.error('Load collection failed:', e);
      showBottomToast('加载失败');
      libraryStore.setList([]);
    } finally {
      isLoading.value = false;
      hasLoadedOnce.value = true;
      currentLoadPromise = null;
      tryOpenPendingEdit();
    }
  })();
  
  return currentLoadPromise;
};

const onCollectionDeleted = async (deletedId?: string) => {
    if (deletedId) {
        const nextList = list.value.filter((item) => item.id !== deletedId);
        libraryStore.setList(nextList);
    }
    libraryStore.invalidate();
    await loadData(true);
};

const sharedImportLink = ref('');

const {
  showEdit,
  editMode,
  editPreview,
  editForm,
  setEditType,
  openEdit,
  confirmEdit,
  confirmSaveAsCopy
} = useLibraryEdit(list, () => loadData(true), sharedImportLink);

const {
  showImport,
  importType,
  importLink: _importLink,
  showBatchImport,
  importBatchList,
  scanImport,
  handleImport,
  confirmBatchImport
} = useLibraryImport(() => loadData(true), showEdit, editMode, editPreview, editForm);

const importLink = computed({
    get: () => _importLink.value,
    set: (val) => {
        _importLink.value = val;
        sharedImportLink.value = val;
    }
});

watch(sharedImportLink, (val) => {
    if (_importLink.value !== val) _importLink.value = val;
});

const tryOpenPendingEdit = () => {
  if (!pendingEditId.value) return;
  const target = list.value.find((i) => i.id === pendingEditId.value);
  if (!target) return;
  openEdit(target.id);
  pendingEditId.value = '';
};

const { showShareModal, currentShareLink, currentShareTitle, currentShareText, currentShareSummary, currentShareWakeTip, handleShare } = useShare();
const showBottomToast = (title: string, duration = 1500) => {
    uni.showToast({ title, icon: 'none', position: 'bottom', duration });
};

const onSetting = () => {
    showBottomToast('设定功能开发中');
};

const handleManualRefresh = async () => {
    await loadData(true);
    showBottomToast('已刷新');
};

const goBack = () => uni.reLaunch({ url: '/pages/provider/dashboard/index' });

const updateExpandedGroup = (key: string, value: boolean) => {
    const targetKey = key as 'active' | 'selfOffline' | 'upstreamOffline';
    if (expandedGroups.value[targetKey] === value) return;
    toggleCollectionGroup(targetKey);
};

const toggleCollectionStatus = (item: any) => {
    console.log('[LibraryPanel] toggleCollectionStatus triggered for item:', item?.id);
    if (!item || !item.id) {
        showBottomToast('数据异常，无法操作');
        return;
    }
    const id = item.id;
    const nextActive = item.status !== 'ACTIVE';
    const title = nextActive ? '上架收藏' : '下架收藏';
    const content = nextActive
        ? (isParentInactive(item) ? '上级已下架，当前上架后仍无法预约；待上级恢复后将自动可预约。是否继续？' : '确定要上架该收藏吗？')
        : '下架后该链路下游也会变为下架状态，确定继续吗？';

    void (async () => {
        console.log('[LibraryPanel] showing confirm dialog');
        const res = await showAppConfirm({ title, content });
        console.log('[LibraryPanel] confirm result:', res);
        if (!res.confirm) return;
        try {
              await updateDistributionLinkStatus(id, nextActive);
              showBottomToast(nextActive ? '已上架' : '已下架');
            loadData(true);
        } catch(e) {
            console.error(e);
            const errorCode = (e as any)?.error_code || (e as any)?.data?.error_code;
            const activeCount = Number((e as any)?.active_count ?? (e as any)?.data?.active_count);
            const activeLimit = Number((e as any)?.active_limit ?? (e as any)?.data?.active_limit);
            
            if (errorCode === 'COLLECTION_ACTIVE_LIMIT_EXCEEDED' && Number.isFinite(activeCount) && Number.isFinite(activeLimit)) {
                showBottomToast(`已达上限(${activeCount}/${activeLimit})，请先扩容或下架`, 2000);
            } else {
                const msg = (e as any)?.data?.message || (e as any)?.message || '操作失败';
                showBottomToast(msg);
            }
        }
    })();
};

const createDistributionLinkAction = async (item: any) => {
    await handleShare(item, { targetType: 'SINGLE', useServiceIdFallback: true });
};

const emit = defineEmits<{
    (e: 'open-booking', params: { agency_node_id: string }): void;
}>();

const book = async (item: any) => {
    if (isBookingUnavailable(item?.id, item?.service?.id)) {
        showBottomToast(getBookingUnavailableMessage(item?.id, item?.service?.id), 2200);
        return;
    }
    
    // Strict check: Block offline items
    if (isCollectionOffline(item)) {
        const reason = getCollectionStatusText(item);
        showBottomToast(`${reason}，暂无法预约`);
        return;
    }

    // Strict constraint: Pass only agency_node_id to enforce chain validation
    // Do NOT fallback to service_id
    emit('open-booking', { agency_node_id: item.id });
};

provideLibraryListContext({
    pageSizeOptions,
    pageSize,
    availabilityMap: mergedAvailabilityMap,
    onEdit: openEdit,
    onToggle: toggleCollectionStatus,
    onPromote: createDistributionLinkAction,
    onBook: book,
});

onMounted(() => {
  loadGroupState();
  loadData(false);
  if (props.editId) {
      pendingEditId.value = props.editId;
  }

  // Visibility change listener for H5/Browser
  if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', onVisibilityChange);
  }
  onLibraryInvalidation(onExternalLibraryInvalidate);
});

let lastVisibilityRefreshAt = 0;
const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastVisibilityRefreshAt < 1000) return;
        lastVisibilityRefreshAt = now;
        loadData(false);
    }
};

const onExternalLibraryInvalidate = () => {
    libraryStore.invalidate();
    void loadData(true);
};

onUnmounted(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', onVisibilityChange);
    }
    offLibraryInvalidation(onExternalLibraryInvalidate);
});

watch(() => props.editId, (newVal) => {
    if (newVal) {
        pendingEditId.value = newVal;
        tryOpenPendingEdit();
    }
});

defineExpose({
    refresh: loadData
});
</script>

<style lang="scss" scoped>
.content-wrapper {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    /* Removed overflow hidden to allow parent scroll */
}

.refresh-tip {
    width: 100%;
    text-align: center;
    font-size: 12px;
    color: $uni-text-color-placeholder;
}

.list-skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skeleton-card {
    height: 88px;
    border-radius: 14px;
    background: linear-gradient(90deg, rgba(220,220,220,0.55) 25%, rgba(235,235,235,0.9) 37%, rgba(220,220,220,0.55) 63%);
    background-size: 400% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0 0; }
}

.service-list,
.status-groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
}
</style>
