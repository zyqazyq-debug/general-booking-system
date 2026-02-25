<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">编辑日程</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper" v-if="!loading">
        <view class="card">
            <view class="card-header">基本信息</view>
            <view class="card-body">
                <view class="mb-3">
                    <text class="form-label">标题</text>
                    <input class="form-control" v-model="form.title" placeholder="例如：钢琴课、咨询服务" />
                </view>

                <view class="row mb-3">
                    <view class="col-6">
                        <text class="form-label">基础价格 (元)</text>
                        <input class="form-control" type="number" v-model="form.base_price" placeholder="0.00" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">所需积分</text>
                        <input class="form-control" type="number" v-model="form.deposit_points" placeholder="0" />
                    </view>
                </view>

                <view class="row mb-3">
                    <view class="col-6">
                        <text class="form-label">时长 (分钟)</text>
                        <input class="form-control" type="number" v-model="form.duration_minutes" placeholder="60" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">缓冲 (分钟)</text>
                        <input class="form-control" type="number" v-model="form.buffer_minutes" placeholder="0" />
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
                        <input class="form-control" type="number" v-model="rules.start_hour" placeholder="9" />
                    </view>
                    <view class="col-6">
                        <text class="form-label">结束时间 (小时)</text>
                        <input class="form-control" type="number" v-model="rules.end_hour" placeholder="17" />
                    </view>
                </view>

                <view class="mb-3">
                    <text class="form-label">工作日 (1=周一)</text>
                    <checkbox-group @change="onWeekdayChange" class="weekday-group">
                        <label v-for="day in 7" :key="day" class="weekday-item">
                            <checkbox :value="String(day)" :checked="rules.weekdays.includes(day)" color="#4e97fc" /> 
                            <text class="ml-1">{{ day }}</text>
                        </label>
                    </checkbox-group>
                </view>
            </view>
        </view>
        
        <button class="btn btn-primary" @click="submit">保存修改</button>
        <button class="btn btn-outline-danger mt-3" @click="confirmDelete">删除日程</button>
    </view>
    <view v-else class="center-content">
        <text>加载中...</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { request } from '@/utils/request';

const id = ref('');
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

onLoad(async (options: any) => {
    id.value = options.id;
    await loadData();
});

const loadData = async () => {
    try {
        const res: any = await request({ url: `/schedules/${id.value}` });
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
        }
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '加载失败', icon: 'none' });
    } finally {
        loading.value = false;
    }
};

const onWeekdayChange = (e: any) => {
    rules.weekdays = e.detail.value.map((v: string) => parseInt(v));
};

const goBack = () => uni.navigateBack();

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
        }
    };
    
    await request({ url: `/schedules/${id.value}`, method: 'PATCH', data: payload });
    
    uni.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => {
        uni.navigateBack();
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
                    await request({ url: `/schedules/${id.value}`, method: 'DELETE' });
                    uni.showToast({ title: '已删除', icon: 'success' });
                    setTimeout(() => uni.navigateBack(), 1000);
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