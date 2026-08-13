import { reactive, ref, computed, onMounted } from 'vue';
import { createDistributionLink } from '@/domains/library';

export function useDistributionCreateLink(props: {
    serviceId?: string;
    parentNodeId?: string;
    sourceAgentId?: string;
}) {
    const currentServiceId = ref<string>('');
    const form = reactive({
        markup_type: 'FIXED',
        markup_value: 0,
        note: ''
    });
    const link = ref<any>(null);
    const complianceAgreed = ref(false);

    const initData = () => {
        currentServiceId.value = props.serviceId || '';
    };

    onMounted(() => {
        initData();
    });

    const onTypeChange = (e: any) => {
        form.markup_type = e.detail.value;
    };

    const onComplianceChange = (e: any) => {
        complianceAgreed.value = e.detail.value.includes('agreed');
    };

    const generate = async () => {
        if (!currentServiceId.value) return;
        if (!complianceAgreed.value) {
            uni.showToast({ title: '请先阅读并同意合规承诺', icon: 'none' });
            return;
        }
        
        try {
            const res = await createDistributionLink({
                serviceId: currentServiceId.value,
                markup_type: form.markup_type as 'FIXED' | 'PERCENT',
                markup_value: Number(form.markup_value),
                private_note: form.note,
                compliance_content: `
                1. 本链接仅用于合法合规的服务分享，严禁用于黄赌毒、诈骗、非法集资等违法活动。
                2. 不得通过虚假宣传、误导性陈述欺骗消费者。
                3. 承诺对因分享行为产生的法律后果承担全部责任。
                4. 平台有权在发现违规行为时立即冻结账号并配合执法机关调查。
                `.trim(),
                compliance_signature: `AGREED_BY_USER_AT_${new Date().toISOString()}`
            });
            link.value = res;
            
            uni.showToast({ title: '链接已生成', icon: 'success' });
        } catch (e) {
            console.error(e);
            uni.showToast({ title: '生成失败', icon: 'none' });
        }
    };

    const linkUrl = computed(() => {
        if (!link.value) return '';
        const base = typeof window !== 'undefined' && window.location ? window.location.origin : '';
        return `${base}/${String(link.value.share_slug || '')}`;
    });

    const copyLink = () => {
        uni.setClipboardData({
            data: linkUrl.value,
            success: () => uni.showToast({ title: '已复制!' })
        });
    };

    return {
        currentServiceId,
        form,
        link,
        complianceAgreed,
        onTypeChange,
        onComplianceChange,
        generate,
        linkUrl,
        copyLink
    };
}
