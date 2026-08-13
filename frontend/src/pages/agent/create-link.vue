<template>
  <AppPage title="创建分销链接" :with-navbar="true" :show-back="true" :padding="'16px'">
    <view class="create-link-page">
        <AppCard title="设置分享参数" :padding="'16px'">
                <view class="form-group form-group-lg">
                    <text class="form-label">加价类型</text>
                    <radio-group class="radio-group" @change="onTypeChange">
                        <label class="radio-label">
                            <radio value="FIXED" :checked="form.markup_type === 'FIXED'" color="#4e97fc" /> 
                            <text class="radio-text">固定金额</text>
                        </label>
                        <label class="radio-label">
                            <radio value="PERCENT" :checked="form.markup_type === 'PERCENT'" color="#4e97fc" /> 
                            <text class="radio-text">百分比</text>
                        </label>
                    </radio-group>
                </view>

                <view class="form-group form-group-lg">
                    <text class="form-label">加价数值</text>
                    <view class="input-wrapper">
                        <input v-model="form.markup_value" class="agent-input" type="number" placeholder="0" />
                        <text class="suffix">{{ form.markup_type === 'FIXED' ? '元' : '%' }}</text>
                    </view>
                </view>

                <view class="form-group form-group-lg">
                    <text class="form-label">备注 (仅自己可见)</text>
                    <input v-model="form.note" class="agent-input" placeholder="例如：社交分享" />
                </view>

                <view class="compliance-box form-group-lg">
                    <view class="compliance-header">
                        <checkbox-group @change="onComplianceChange">
                            <label class="checkbox-label">
                                <checkbox value="agreed" color="#4e97fc" :checked="complianceAgreed" />
                                <text class="compliance-text">我承诺遵守以下自律规范</text>
                            </label>
                        </checkbox-group>
                    </view>
                    <view class="compliance-content">
                        <text class="compliance-item">1. 本链接仅用于合法合规的服务分享，严禁用于黄赌毒、诈骗、非法集资等违法活动。</text>
                        <text class="compliance-item">2. 不得通过虚假宣传、误导性陈述欺骗消费者。</text>
                        <text class="compliance-item">3. 承诺对因分享行为产生的法律后果承担全部责任。</text>
                        <text class="compliance-item">4. 平台有权在发现违规行为时立即冻结账号并配合执法机关调查。</text>
                    </view>
                </view>

                <AppButton type="primary" block :disabled="!complianceAgreed" @click="generate">创建分销链接</AppButton>
        </AppCard>

        <AppCard v-if="link" class="result-card" title="生成结果" :padding="'16px'">
                <view class="link-box">
                    <text class="link-text">{{ linkUrl }}</text>
                </view>
                <AppButton type="primary" outline block class="copy-action" @click="copyLink">复制链接</AppButton>
        </AppCard>
    </view>
  </AppPage>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { onLoad } from "@dcloudio/uni-app";
import { createAgentLink } from '@/domains/distribution';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';
import AppButton from '@/shared/components/AppButton.vue';

const serviceId = ref('');
const form = reactive({
    markup_type: 'FIXED',
    markup_value: 0,
    note: ''
});
const link = ref<any>(null);
const complianceAgreed = ref(false);

onLoad((options: any) => {
    serviceId.value = options.service_id || '';
});

const onTypeChange = (e: any) => {
    form.markup_type = e.detail.value;
};

const onComplianceChange = (e: any) => {
    complianceAgreed.value = e.detail.value.includes('agreed');
};

const generate = async () => {
    if (!serviceId.value) return;
    if (!complianceAgreed.value) {
        uni.showToast({ title: '请先阅读并同意合规承诺', icon: 'none' });
        return;
    }
    
    try {
        const res = await createAgentLink({
            service_id: serviceId.value,
            markup_type: form.markup_type as 'FIXED' | 'PERCENT',
            markup_value: Number(form.markup_value),
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
    return `${base}/#/pages/booking/detail?slug=${link.value.share_slug}`;
});

const copyLink = () => {
    uni.setClipboardData({
        data: linkUrl.value,
        success: () => uni.showToast({ title: '已复制!' })
    });
};
</script>

<style lang="scss" scoped>
.create-link-page {
    width: 100%;
}
.form-group-lg {
    margin-bottom: 16px;
}
.agent-input {
    width: 100%;
    height: 40px;
    border: 1px solid $uni-border-color;
    border-radius: $uni-radius-base;
    padding: 0 12px;
    font-size: 14px;
    color: $uni-text-color-secondary;
    background: $uni-bg-color;
    box-sizing: border-box;
}
.agent-input:focus {
    border-color: $uni-color-primary;
}
.radio-group {
    display: flex;
    gap: 24px;
    margin-top: 8px;
}
.radio-label {
    display: flex;
    align-items: center;
}
.radio-text {
    margin-left: 6px;
    font-size: 14px;
    color: $uni-text-color-secondary;
}

.input-wrapper {
    position: relative;
}
.suffix {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: $uni-text-color-grey;
    font-size: 14px;
}

.link-box {
    background-color: $uni-bg-color-grey;
    padding: 16px;
    border-radius: $uni-radius-base;
    word-break: break-all;
    border: 1px dashed #cbd5e1;
}
.link-text {
    font-family: monospace;
    color: $uni-color-primary;
    font-size: 13px;
    line-height: 1.4;
}

.compliance-box {
    background-color: $uni-bg-color-hover;
    border: 1px solid $uni-border-color;
    border-radius: $uni-radius-base;
    padding: 12px;
}
.compliance-header {
    margin-bottom: 8px;
}
.checkbox-label {
    display: flex;
    align-items: center;
}
.compliance-text {
    font-size: 14px;
    font-weight: 600;
    color: $uni-text-color-secondary;
    margin-left: 8px;
}
.compliance-content {
    font-size: 12px;
    color: $uni-text-color-grey;
    line-height: 1.5;
    padding-left: 8px;
}
.compliance-item {
    display: block;
    margin-bottom: 4px;
}
.copy-action {
    margin-top: 12px;
}
</style>
