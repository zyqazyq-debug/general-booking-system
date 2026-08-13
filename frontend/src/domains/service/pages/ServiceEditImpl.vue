<template>
  <AppPage 
      :title="currentId ? '编辑服务' : '新建服务'" 
      :with-navbar="true" 
      :with-tabbar="false" 
      padding="16px"
      :custom-back="true"
      @back="goBack"
  >

    <view v-if="!loading" class="content-wrapper">
        <view class="card">
            <view class="card-header">基本信息</view>
            <view class="card-body">
                <view class="mb-3">
                    <text class="form-label">标题</text>
                    <input v-model="form.title" class="form-control" placeholder="例如：钢琴课、咨询服务" />
                </view>

                <view class="row mb-3">
                    <view class="col-6">
                        <text class="form-label">基础价格 (元)</text>
                        <input v-model="form.base_price" class="form-control" type="number" placeholder="0.00" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">所需积分</text>
                        <input v-model="form.deposit_points" class="form-control" type="number" placeholder="0" />
                    </view>
                </view>

                <view class="row mb-3">
                    <view class="col-6">
                        <text class="form-label">时长 (分钟)</text>
                        <input v-model="form.duration_minutes" class="form-control" type="number" placeholder="60" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">缓冲 (分钟)</text>
                        <input v-model="form.buffer_minutes" class="form-control" type="number" placeholder="0" />
                    </view>
                </view>
            </view>
        </view>

        <view class="card">
            <view class="card-header">可用性规则</view>
            <view class="card-body">
                <view class="row mb-3">
                    <view class="col-6">
                        <text class="form-label">开始时间 (小时)</text>
                        <input v-model="rules.start_hour" class="form-control" type="number" placeholder="9" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">结束时间 (小时)</text>
                        <input v-model="rules.end_hour" class="form-control" type="number" placeholder="17" />
                    </view>
                </view>

                <view class="mb-3">
                    <text class="form-label">工作日 (1=周一)</text>
                    <checkbox-group class="weekday-group" @change="onWeekdayChange">
                        <label v-for="day in 7" :key="day" class="weekday-item">
                            <checkbox :value="String(day)" :checked="rules.weekdays.includes(day)" color="#4e97fc" /> 
                            <text class="ml-1">{{ day }}</text>
                        </label>
                    </checkbox-group>
                </view>
            </view>
        </view>
        
        <view class="card">
            <view class="card-header">取消政策</view>
            <view class="card-body">
                <view class="row mb-3">
                     <view class="col-6">
                         <text class="form-label">免费取消窗口 (分钟)</text>
                         <input v-model="policy.window_minutes" class="form-control" type="number" placeholder="120" />
                         <text class="form-hint">开场前多少分钟可免费取消</text>
                     </view>
                     <view class="col-6">
                         <text class="form-label">违约扣费比例 (%)</text>
                         <input v-model="policy.penalty_percent" class="form-control" type="number" placeholder="0" />
                         <text class="form-hint">超时取消扣除比例</text>
                     </view>
                </view>
            </view>
        </view>
        
        <button class="btn btn-primary" @click="submit">保存修改</button>
        <button class="btn btn-outline-danger mt-3" @click="confirmDelete">删除日程</button>
    </view>
    <view v-else class="center-content">
        <text>加载中...</text>
    </view>
  </AppPage>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { request } from '@/shared/api/request';
import { getServiceDetail, createService, updateService } from '@/shared/api/service';
import AppPage from '@/shared/components/AppPage.vue';
import AppCard from '@/shared/components/AppCard.vue';

const props = defineProps<{
    id: string;
}>();

const emit = defineEmits<{
    (e: 'back'): void;
}>();

const goBack = () => {
    emit('back');
};

const currentId = ref('');
const loading = ref(true);

const form = reactive({
  title: '',
  base_price: 0,
  deposit_points: 0,
  duration_minutes: 60,
  buffer_minutes: 0,
  is_active: true
});

const rules = reactive({
    start_hour: 9,
    end_hour: 17,
    weekdays: [1, 2, 3, 4, 5]
});

const policy = reactive({
    type: 'custom',
    window_minutes: 120,
    penalty_percent: 0
});

const initData = async () => {
    if (props.id) {
        currentId.value = props.id;
        loading.value = true;
        try {
            const res: any = await getServiceDetail(props.id);
            if (res) {
                form.title = res.title;
                form.base_price = res.base_price;
                form.deposit_points = res.deposit_points;
                form.duration_minutes = res.duration_minutes;
                form.buffer_minutes = res.buffer_minutes;
                form.is_active = res.is_active;
                
                if (res.rules) {
                    rules.start_hour = res.rules.start_hour;
                    rules.end_hour = res.rules.end_hour;
                    rules.weekdays = res.rules.weekdays || [];
                }
                if (res.cancellation_policy) {
                    policy.window_minutes = res.cancellation_policy.window_minutes || 120;
                    policy.penalty_percent = res.cancellation_policy.penalty_percent || 0;
                }
            }
        } catch (e: any) {
            console.error(e);
            uni.showToast({ title: e.message || '加载失败', icon: 'none' });
        } finally {
            loading.value = false;
        }
    } else {
        loading.value = false;
    }
};

onMounted(() => {
    initData();
});

const onWeekdayChange = (e: any) => {
    rules.weekdays = e.detail.value.map((v: string) => parseInt(v));
};



const submit = async () => {
  try {
    if(!form.title) return uni.showToast({ title: '请输入标题', icon: 'none' });
    
    const payload = {
        ...form,
        base_price: Number(form.base_price),
        deposit_points: Number(form.deposit_points),
        duration_minutes: Number(form.duration_minutes),
        buffer_minutes: Number(form.buffer_minutes),
        rules: {
            ...rules,
            start_hour: Number(rules.start_hour),
            end_hour: Number(rules.end_hour)
        },
        cancellation_policy: {
            ...policy,
            window_minutes: Number(policy.window_minutes),
            penalty_percent: Number(policy.penalty_percent)
        }
    };
    
    await request({ url: `/services/${currentId.value}`, method: 'PATCH', data: payload });
    
    uni.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
            uni.navigateBack();
        } else {
            uni.reLaunch({ url: '/pages/index/index' });
        }
    }, 1500);
  } catch (e) {
    console.error(e);
    uni.showToast({ title: '保存失败', icon: 'none' });
  }
};

const confirmDelete = () => {
    uni.showModal({
        title: '确认删除',
        content: '确定要删除这个日程吗？此操作不可恢复。',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/services/${currentId.value}`, method: 'DELETE' });
                    uni.showToast({ title: '已删除', icon: 'success' });
                    setTimeout(() => {
                        const pages = getCurrentPages();
                        if (pages.length > 1) {
                            uni.navigateBack();
                        } else {
                            uni.reLaunch({ url: '/pages/index/index' });
                        }
                    }, 1000);
                } catch (e) {
                    console.error(e);
                    uni.showToast({ title: '删除失败', icon: 'none' });
                }
            }
        }
    });
};
</script>

<style>
.weekday-group { display: flex; flex-wrap: wrap; gap: 15px; }
.weekday-item { display: flex; align-items: center; }
.ml-1 { margin-left: 5px; }
.btn-outline-danger { 
    background: transparent; 
    border: 1px solid #ef4444; 
    color: #ef4444; 
    box-shadow: none;
}
</style>
