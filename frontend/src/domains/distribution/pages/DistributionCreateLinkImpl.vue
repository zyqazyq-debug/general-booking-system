<template>
  <AppPage 
    title="创建分销链接" 
    :with-navbar="true" 
    :show-back="false" 
    :padding="'16px'"
    :custom-back="true"
    @back="goBack"
  >
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
                        <input v-model="form.markup_value" class="distribution-input" type="number" placeholder="0" />
                        <text class="suffix">{{ form.markup_type === 'FIXED' ? '元' : '%' }}</text>
                    </view>
                </view>

                <view class="form-group form-group-lg">
                    <text class="form-label">备注 (仅自己可见)</text>
                    <input v-model="form.note" class="distribution-input" placeholder="例如：社交分享" />
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
import { useDistributionCreateLink } from '../composables/useDistributionCreateLink';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';
import AppButton from '@/shared/components/AppButton.vue';

const props = defineProps<{
    serviceId?: string;
    parentNodeId?: string;
    sourceAgentId?: string;
}>();

const emit = defineEmits<{
    (e: 'back'): void;
}>();

const goBack = () => {
    emit('back');
};

const {
    form,
    link,
    complianceAgreed,
    onTypeChange,
    onComplianceChange,
    generate,
    linkUrl,
    copyLink
} = useDistributionCreateLink(props);

</script>

<style lang="scss" scoped>
.create-link-page {
    width: 100%;
}
.form-group-lg {
    margin-bottom: 16px;
}
.distribution-input {
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
.distribution-input:focus {
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
