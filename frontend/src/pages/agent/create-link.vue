<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">生成分销链接</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <view class="card">
            <view class="card-header">
                <text class="card-title">设置分销参数</text>
            </view>
            <view class="card-body">
                <view class="form-group mb-4">
                    <text class="form-label">加价类型</text>
                    <radio-group @change="onTypeChange" class="radio-group">
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

                <view class="form-group mb-4">
                    <text class="form-label">加价数值</text>
                    <view class="input-wrapper">
                        <input class="form-control" type="number" v-model="form.markup_value" placeholder="0" />
                        <text class="suffix">{{ form.markup_type === 'FIXED' ? '元' : '%' }}</text>
                    </view>
                </view>

                <view class="form-group mb-4">
                    <text class="form-label">备注 (仅自己可见)</text>
                    <input class="form-control" v-model="form.note" placeholder="例如：朋友圈推广" />
                </view>

                <button class="btn btn-primary" @click="generate">生成链接</button>
            </view>
        </view>

        <view class="card result-card" v-if="link">
            <view class="card-header">
                <text class="card-title">生成结果</text>
            </view>
            <view class="card-body">
                <view class="link-box">
                    <text class="link-text">{{ linkUrl }}</text>
                </view>
                <button class="btn btn-outline-primary mt-3" @click="copyLink">复制链接</button>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { onLoad } from "@dcloudio/uni-app";
import { createAgentLink } from '@/api/agent';

const scheduleId = ref('');
const form = reactive({
    markup_type: 'FIXED',
    markup_value: 0,
    note: ''
});
const link = ref<any>(null);

onLoad((options: any) => {
    scheduleId.value = options.schedule_id;
});

const onTypeChange = (e: any) => {
    form.markup_type = e.detail.value;
};

const goBack = () => uni.navigateBack();

const generate = async () => {
    if (!scheduleId.value) return;
    try {
        const res = await createAgentLink({
            schedule_id: scheduleId.value,
            markup_type: form.markup_type as 'FIXED' | 'PERCENT',
            markup_value: Number(form.markup_value)
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
    return `${base}/#/pages/booking/detail?token=${link.value.token}`;
});

const copyLink = () => {
    uni.setClipboardData({
        data: linkUrl.value,
        success: () => uni.showToast({ title: '已复制!' })
    });
};
</script>

<style>
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
    color: #334155;
}

.input-wrapper {
    position: relative;
}
.suffix {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: #64748b;
    font-size: 14px;
}

.link-box {
    background-color: #f1f5f9;
    padding: 16px;
    border-radius: 8px;
    word-break: break-all;
    border: 1px dashed #cbd5e1;
}
.link-text {
    font-family: monospace;
    color: #4e97fc;
    font-size: 13px;
    line-height: 1.4;
}
</style>
