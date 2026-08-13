import { ref, type Ref } from 'vue';
import { deleteDistributionCollection, getMyCollections } from '@/domains/library';

interface UseScheduleCollectionActionsOptions {
  userStore: {
    isLoggedIn: boolean;
    userInfo: any;
  };
  list: Ref<any[]>;
}

export function useScheduleCollectionActions(options: UseScheduleCollectionActionsOptions) {
  const showShareModal = ref(false);
  const currentShareLink = ref('');

  const loadData = async () => {
    if (!options.userStore.isLoggedIn) return;
    try {
      uni.showLoading({ title: '加载中...' });
      options.list.value = await getMyCollections();
    } catch (error) {
      console.error(error);
      uni.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      uni.hideLoading();
    }
  };

  const remove = (id: string) => {
    uni.showModal({
      title: '移除收藏',
      content: '确定要从收藏列表中移除吗？',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await deleteDistributionCollection(id);
          options.list.value = options.list.value.filter((item) => item.id !== id);
          uni.showToast({ title: '已移除', icon: 'none' });
        } catch (error) {
          console.error(error);
          uni.showToast({ title: '操作失败', icon: 'none' });
        }
      },
    });
  };

  const createAgentLink = (id: string) => {
    const item = options.list.value.find((entry) => entry.id === id);
    if (!item) return;

    if (!item.share_slug) {
      uni.showToast({ title: '该项暂未分配分享短链，请重新收藏', icon: 'none' });
      console.error('Missing share_slug for collection item:', item);
      return;
    }

    const path = `/pages/booking/detail?slug=${item.share_slug}`;
    let fullUrl = path;
    // #ifdef H5
    fullUrl = window.location.origin + '/#' + path;
    // #endif

    currentShareLink.value = fullUrl;
    showShareModal.value = true;
  };

  const book = (id: string) => {
    const item = options.list.value.find((entry) => entry.id === id);
    if (!item) return;

    if (item.service_id) {
      uni.navigateTo({ url: `/pages/booking/detail?agency_node_id=${item.id}` });
      return;
    }
    uni.navigateTo({ url: `/pages/booking/detail?schedule_id=${item.id}` });
  };

  const goBack = () => uni.reLaunch({ url: '/pages/index/index' });
  const goToHome = () => uni.reLaunch({ url: '/pages/index/index' });
  const goToPersonal = () => uni.reLaunch({ url: '/pages/user/profile' });

  return {
    showShareModal,
    currentShareLink,
    loadData,
    remove,
    createAgentLink,
    book,
    goBack,
    goToHome,
    goToPersonal,
  };
}
