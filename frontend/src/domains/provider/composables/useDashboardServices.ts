import { ref } from 'vue';
import { useServiceStore } from '../stores/service';
import { deleteService, updateService, getMyServices } from '@/shared/api/service';
import { request } from '@/utils/request';
import { showAppConfirm } from '@/utils/app-confirm';
import { useShare } from '@/shared/composables/useShare';
import { emitLibraryInvalidation } from '@/shared/composables/useLibraryInvalidation';
import { useUserStore } from '@/shared/stores/user';

export function useDashboardServices() {
    const serviceStore = useServiceStore();
    const services = ref<any[]>(serviceStore.services);
    
    // Watch store changes to sync local ref if needed, 
    // but better to just use store directly or computed.
    // However, the original code used ref, let's stick to a simple sync for now
    // or better, just use computed if possible. 
    // Actually, many places in this file modify services.value directly.
    
    const pendingServices = ref<any[]>([]);
    const activeTab = ref(0);
    
    // Modal state
    const showServiceModal = ref(false);
    const editingServiceId = ref('');

    // Share state (from composable)
    const { showShareModal, currentShareLink, currentShareTitle, currentShareText, currentShareSummary, currentShareWakeTip, handleShare } = useShare();
    
    // Loading state & Cache
    const isLoading = ref(false);
    let currentLoadPromise: Promise<void> | null = null;

    const loadServices = async (force = false) => {
        const userStore = useUserStore();
        if (!userStore.isLoggedIn) return;
        if (currentLoadPromise) return currentLoadPromise;
        if (!force && serviceStore.services.length > 0 && !serviceStore.isStale()) {
            return;
        }

        currentLoadPromise = (async () => {
            try {
                isLoading.value = true;
                // Show loading if force refresh OR first load
                if (force || !serviceStore.services.length) {
                    uni.showLoading({ title: '加载中...' });
                }
                const res: any = await getMyServices();
                let newList = [];
                if (res && res.data && Array.isArray(res.data)) {
                    newList = res.data;
                } else if (res && res.data) {
                    newList = res.data;
                } else if (Array.isArray(res)) {
                    newList = res;
                }
                serviceStore.setServices(newList);
                services.value = newList;
            } catch (e) {
                console.error(e);
                uni.showToast({ title: '加载服务失败', icon: 'none' });
            } finally {
                isLoading.value = false;
                uni.hideLoading();
                currentLoadPromise = null;
            }
        })();
        
        return currentLoadPromise;
    };

    const toggleActive = async (item: any) => {
        const nextVal = !item.is_active;
        
        // If deactivating, check first
        if (!nextVal) {
             uni.showLoading({ title: '检查中...' });
             try {
                 const checkRes: any = await request({ url: `/services/${item.id}/deactivate-check`, method: 'GET' });
                 uni.hideLoading();
                 const res = await showAppConfirm({
                     title: '确认下架',
                     content: checkRes.message || '服务即将暂停，后续用户无法预约，已经预约订单不受影响。',
                     confirmText: '确认下架',
                     cancelText: '取消'
                 });
                 if (!res.confirm) return;
             } catch (e: any) {
                 uni.hideLoading();
                 const msg = e?.data?.message || e?.message || '无法获取状态';
                 uni.showToast({ title: msg, icon: 'none' });
                 return;
             }
        }

        try {
            await updateService(item.id, { is_active: nextVal });
            item.is_active = nextVal;
            emitLibraryInvalidation();
            uni.showToast({ title: nextVal ? '已上架' : '已下架', icon: 'none' });
        } catch (err) {
            console.error(err);
            uni.showToast({ title: '操作失败', icon: 'none' });
        }
    };

    const deleteServiceItem = async (id: string) => {
        console.log('[useDashboardServices] deleteServiceItem called for id:', id);
        const res = await showAppConfirm({
            title: '确认删除',
            content: '删除后无法恢复，确定要删除吗？'
        });
        console.log('[useDashboardServices] confirm result:', res);
        if (!res.confirm) return;
        try {
            await deleteService(id);
            uni.showToast({ title: '已删除', icon: 'none' });
            emitLibraryInvalidation();
            loadServices(true);
        } catch (e) {
            console.error(e);
            uni.showToast({ title: '删除失败', icon: 'none' });
        }
    };

    const shareService = async (item: any) => {
        await handleShare(item, { targetType: 'SINGLE' });
    };

    const openEditModal = (id: string) => {
        editingServiceId.value = id;
        showServiceModal.value = true;
    };

    const openCreateModal = () => {
        editingServiceId.value = '';
        showServiceModal.value = true;
    };
    
    const onModalRefresh = () => {
        emitLibraryInvalidation();
        loadServices(true);
    };

    return {
        services,
        pendingServices,
        activeTab,
        showServiceModal,
        editingServiceId,
        showShareModal,
        currentShareLink,
        currentShareTitle,
        currentShareText,
        currentShareSummary,
        currentShareWakeTip,
        loadServices,
        toggleActive,
        deleteServiceItem,
        shareService,
        openEditModal,
        openCreateModal,
        onModalRefresh
    };
}
