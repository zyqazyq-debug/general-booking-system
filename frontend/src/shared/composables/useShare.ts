import { ref } from 'vue';
import { tryWakeShare, formatShareWakeTip } from '@/shared/utils/share-wakeup';

export function useShare() {
    const enableShareWakeTip = import.meta.env.VITE_SHARE_WAKE_TIP === 'true';
    const showShareModal = ref(false);
    const currentShareLink = ref('');
    const currentShareTitle = ref('');
    const currentShareText = ref('');
    const currentShareWakeTip = ref('');
    const currentShareSummary = ref<{
        name: string;
        price: string;
        duration: string;
    } | null>(null);

    const showShareWakeTip = (tip: string) => {
        if (!enableShareWakeTip) {
            currentShareWakeTip.value = '';
            return;
        }
        currentShareWakeTip.value = tip;
    };
    const resolvePrice = (item: any): number | null => {
        const raw = item?.cache_total_price ?? item?.sale_price ?? item?.base_price ?? item?.service?.sale_price ?? item?.service?.base_price;
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    };
    const resolveDuration = (item: any): number | null => {
        const raw = item?.duration_minutes ?? item?.service?.duration_minutes;
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    };
    const buildShareText = (item: any, title: string): string => {
        const lines: string[] = [`服务：${title}`];
        const price = resolvePrice(item);
        const duration = resolveDuration(item);
        if (price !== null) {
            lines.push(`价格：¥${price}`);
        }
        if (duration !== null) {
            lines.push(`时长：${duration}分钟`);
        }
        return lines.join('\n');
    };
    const applyShareMeta = (item: any, title: string) => {
        currentShareWakeTip.value = '';
        currentShareTitle.value = title;
        currentShareText.value = buildShareText(item, title);
        const price = resolvePrice(item);
        const duration = resolveDuration(item);
        currentShareSummary.value = {
            name: title,
            price: price === null ? '-' : `¥${price.toFixed(2)}`,
            duration: duration === null ? '-' : `${duration}分钟`,
        };
    };

    /**
     * Share an item (Service or Collection)
     * @param item The item object to share
     * @param options Configuration for sharing
     */
    const handleShare = async (item: any, options: { 
        targetType?: 'SINGLE' | 'COLLECTION', // Default SINGLE
        targetIdField?: string, // Field name for ID, default 'id'
        titleField?: string, // Field name for title
        textField?: string, // Template for share text
        useServiceIdFallback?: boolean // If true, try item.service_id if targetId is missing
    } = {}) => {
        const title = item.title || item.name || item.alias || item.service?.title || '服务分享';
        const text = options.textField 
            ? options.textField.replace('{title}', title)
            : buildShareText(item, title);
        applyShareMeta(item, title);
            
        const slug = item?.share_slug;
        if (!slug) {
            uni.showToast({ title: '缺少分享标识', icon: 'none', position: 'bottom' });
            return;
        }
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const shareLink = `${origin}/${String(slug)}`;
        currentShareLink.value = shareLink;
        showShareModal.value = true;
        void tryWakeShare({ url: shareLink, title, text }).then((result) => {
            showShareWakeTip(formatShareWakeTip(result));
        });
    };

    return {
        showShareModal,
        currentShareLink,
        currentShareTitle,
        currentShareText,
        currentShareSummary,
        currentShareWakeTip,
        handleShare
    };
}
