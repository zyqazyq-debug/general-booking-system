import { ref, computed, type Ref } from 'vue';

type CollectionGroupKey = 'active' | 'selfOffline' | 'upstreamOffline';
const collectionGroupStorageKey = 'library_collection_groups';

export function useLibraryGroups(filteredList: Ref<any[]>) {
  const expandedGroups = ref<Record<CollectionGroupKey, boolean>>({
    active: true,
    selfOffline: false,
    upstreamOffline: false,
  });

  const isParentInactive = (item: any) => {
    return !!item?.parent_node_id && item?.parent_node?.status !== 'ACTIVE';
  };

  const isCollectionOffline = (item: any) => {
    return (
      item?.status !== 'ACTIVE' ||
      isParentInactive(item) ||
      !item?.service?.is_active
    );
  };

  const isSelfOffline = (item: any) => {
    return item?.status !== 'ACTIVE';
  };

  const isUpstreamOffline = (item: any) => {
    return item?.status === 'ACTIVE' && (isParentInactive(item) || !item?.service?.is_active);
  };

  const activeCollections = computed(() => {
    return filteredList.value.filter((item) => !isCollectionOffline(item));
  });

  const selfOfflineCollections = computed(() => {
    return filteredList.value.filter((item) => isSelfOffline(item));
  });

  const upstreamOfflineCollections = computed(() => {
    return filteredList.value.filter((item) => isUpstreamOffline(item));
  });

  const collectionGroups = computed(() => {
    return [
      {
        key: 'active' as const,
        title: '收藏日程',
        emptyText: '收藏列表为空，可导入他人分享链接并再次分享',
        items: activeCollections.value,
      },
      {
        key: 'selfOffline' as const,
        title: '本级下架',
        emptyText: '暂无本级下架服务',
        items: selfOfflineCollections.value,
      },
      {
        key: 'upstreamOffline' as const,
        title: '上级下架',
        emptyText: '暂无上级下架服务',
        items: upstreamOfflineCollections.value,
      },
    ];
  });

  const saveGroupState = () => {
    uni.setStorageSync(
      collectionGroupStorageKey,
      JSON.stringify(expandedGroups.value),
    );
  };

  const loadGroupState = () => {
    try {
      const saved = uni.getStorageSync(collectionGroupStorageKey);
      if (!saved) return;
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (typeof parsed?.active === 'boolean') {
        expandedGroups.value.active = parsed.active;
      }
      if (typeof parsed?.selfOffline === 'boolean') {
        expandedGroups.value.selfOffline = parsed.selfOffline;
      } else if (typeof parsed?.offline === 'boolean') {
        expandedGroups.value.selfOffline = parsed.offline;
      }
      if (typeof parsed?.upstreamOffline === 'boolean') {
        expandedGroups.value.upstreamOffline = parsed.upstreamOffline;
      } else if (typeof parsed?.offline === 'boolean') {
        expandedGroups.value.upstreamOffline = parsed.offline;
      }
    } catch (e) {
      console.error('Load library group state failed:', e);
    }
  };

  const toggleCollectionGroup = (key: CollectionGroupKey) => {
    expandedGroups.value[key] = !expandedGroups.value[key];
    saveGroupState();
  };

  const getCollectionStatusText = (item: any) => {
    if (isSelfOffline(item)) {
      return '本级收藏下架';
    }
    if (isUpstreamOffline(item)) return '上级下架';
    return '上架中';
  };

  return {
    expandedGroups,
    collectionGroups,
    loadGroupState,
    toggleCollectionGroup,
    isCollectionOffline,
    getCollectionStatusText,
    isParentInactive,
  };
}
