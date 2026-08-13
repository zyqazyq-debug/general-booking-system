import { ref, type Ref } from 'vue';
import { request } from '@/utils/request';
import { useUserStore } from '@/shared/stores/user';
import { useBookingConfirmFlow } from './useBookingConfirmFlow';
import { useBookingSubmitFlow } from './useBookingSubmitFlow';
import {
  isCollectionExistsError,
  isSelfCollectionError,
} from '@/utils/error-code';

export function useBookingActions(
  service: Ref<any>,
  sourceAgentId: Ref<string>,
  agencyNodeId: Ref<string>,
  agentLinkToken: Ref<string>,
  selectedDate: Ref<string>,
  selectedSlot: Ref<any>,
  displayPrice: Ref<number>,
  closeModal: () => void,
  emitSuccess: () => void,
) {
  const userStore = useUserStore();
  const collectionLoading = ref(false);

  const addToCollection = async () => {
    if (collectionLoading.value) return;
    collectionLoading.value = true;
    try {
      const currentUserId = userStore.userInfo?.id;
      const isSelfSource = Boolean(
        currentUserId &&
          sourceAgentId.value &&
          currentUserId === sourceAgentId.value,
      );
      if (currentUserId && service.value?.id) {
        const collection: any = await request({
          url: '/agency/collection',
          method: 'GET',
          hideLoading: true,
          hideErrorToast: true,
        });
        if (Array.isArray(collection)) {
          const duplicated = collection.some((item: any) => {
            const sameService = item?.service_id === service.value.id;
            const currentParent = agencyNodeId.value || '';
            const itemParent = item?.parent_node_id || '';
            return (
              sameService &&
              currentParent === itemParent &&
              item?.status === 'ACTIVE'
            );
          });
          if (duplicated) {
            uni.showToast({ title: '已在收藏中', icon: 'none' });
            return;
          }
        }
      }
      const res: any = await request({
        url: '/agency/collection',
        method: 'POST',
        data: {
          serviceId: service.value.id,
          parentNodeId: isSelfSource
            ? undefined
            : agencyNodeId.value || undefined,
        },
        hideErrorToast: true,
      });
      if (
        res?.auth?.access_token &&
        res?.auth?.refresh_token &&
        res?.auth?.user
      ) {
        userStore.login(
          res.auth.user,
          res.auth.access_token,
          res.auth.refresh_token,
        );
      }
      uni.showToast({ title: '已加入收藏', icon: 'success' });
    } catch (e: any) {
      console.error(e);
      if (isSelfCollectionError(e)) {
        uni.showToast({ title: '这是你自己的分享，无需收藏', icon: 'none' });
        return;
      }
      if (isCollectionExistsError(e)) {
        uni.showToast({ title: '已在收藏中', icon: 'none' });
        return;
      }
      uni.showToast({ title: '加入收藏失败', icon: 'none' });
    } finally {
      collectionLoading.value = false;
    }
  };

  const { showConfirmDialog, confirmContent, confirmBooking, closeConfirmDialog } = useBookingConfirmFlow({
    userStore,
    service,
    selectedDate,
    selectedSlot,
    displayPrice,
  });

  const { executeBooking: executeBookingCore } = useBookingSubmitFlow({
    userStore,
    service,
    agencyNodeId,
    agentLinkToken,
    selectedDate,
    selectedSlot,
    onSuccess: emitSuccess,
    onClose: closeModal,
  });

  const executeBooking = async () => {
    closeConfirmDialog();
    await executeBookingCore();
  };

  return {
    collectionLoading,
    addToCollection,
    confirmBooking,
    showConfirmDialog,
    confirmContent,
    executeBooking,
    closeConfirmDialog
  };
}
