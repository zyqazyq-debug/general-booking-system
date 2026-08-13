import { computed, ref, watch } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { resolveUnifiedLink } from '@/domains/distribution';
import { getMyCollections, createDistributionLink } from '@/domains/library';
import { isCollectionExistsError, isSelfCollectionError } from '@/utils/error-code';

export function useBookingImport(props: any) {
    const userStore = useUserStore();
    const currentOptions = ref<any>({});
    
    const isLoggedIn = computed(() => Boolean(userStore.token && userStore.userInfo));
    const isShareBooking = computed(() => Boolean(currentOptions.value?.token || currentOptions.value?.slug));

    const restoreLoginState = () => {
        if (userStore.token && userStore.userInfo) return;
        const token = uni.getStorageSync('token');
        const user = uni.getStorageSync('userInfo');
        if (token && user) {
            userStore.token = token;
            userStore.userInfo = typeof user === 'string' ? JSON.parse(user) : user;
        }
    };

    const importBookingLink = async () => {
        if (!isLoggedIn.value) return;
        const opts = currentOptions.value || {};
        if (!opts.token && !opts.slug) return;
        try {
            let serviceId = '';
            let parentNodeId = '';
            let sourceAgentId = '';
            const code = opts.token || opts.slug;
            const resolved: any = await resolveUnifiedLink(code);
            serviceId = resolved?.import_info?.service_id || '';
            parentNodeId = resolved?.import_info?.parent_node_id || '';
            sourceAgentId = resolved?.agent?.id || '';
            if (!serviceId) return;
            if (sourceAgentId && userStore.userInfo?.id === sourceAgentId) {
                parentNodeId = '';
            }
            const collection: any = await getMyCollections();
            if (Array.isArray(collection)) {
                const duplicated = collection.some((item: any) => {
                    const sameService = item?.service_id === serviceId;
                    const currentParent = parentNodeId || '';
                    const itemParent = item?.parent_node_id || '';
                    return sameService && currentParent === itemParent && item?.status === 'ACTIVE';
                });
                if (duplicated) {
                    uni.showToast({ title: '该分享已在收藏中', icon: 'none' });
                    return;
                }
            }
            await createDistributionLink({
                serviceId,
                parentNodeId: parentNodeId || undefined,
                markup_type: 'FIXED',
                markup_value: 0
            });
        } catch (e: any) {
            console.error(e);
            if (isSelfCollectionError(e)) {
                uni.showToast({ title: '已自动按副本方式导入', icon: 'none' });
                return;
            }
            if (isCollectionExistsError(e)) {
                uni.showToast({ title: '该分享已在收藏中', icon: 'none' });
                return;
            }
        }
    };

    return {
        currentOptions,
        isLoggedIn,
        isShareBooking,
        restoreLoginState,
        importBookingLink
    };
}
