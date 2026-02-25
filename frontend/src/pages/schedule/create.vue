<template>
  <view class="page-container">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">新建日程</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
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
                            <checkbox :value="String(day)" :checked="rules.weekdays.includes(day)" color="#0d6efd" /> 
                            <text class="ml-1">{{ day }}</text>
                        </label>
                    </checkbox-group>
                </view>
            </view>
        </view>
        
        <button class="btn btn-primary" @click="submit">创建日程</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { createSchedule } from '@/api/schedule';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const form = reactive({
  title: '',
  base_price: 0,
  deposit_points: 0,
  duration_minutes: 60,
  buffer_minutes: 0,
  owner_id: userStore.userInfo?.id,
  rules: {} as any
});

const rules = reactive({
    start_hour: 0,
    end_hour: 24,
    weekdays: [1, 2, 3, 4, 5, 6, 7]
});

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
    
    if(!payload.owner_id) payload.owner_id = userStore.userInfo?.id;
    console.log('Creating schedule payload:', payload); // Debug
    await createSchedule(payload);
    
    // Refresh user info or clear cache if needed, but navigate back should trigger onShow in index
    
    uni.showToast({ title: '创建成功!', icon: 'success' });
    setTimeout(() => {
        // Use reLaunch or switchTab if index is a tab page, but navigateBack works if pages stack is correct
        // For safety, let's force refresh via event or just go back
        uni.navigateBack();
    }, 1500);
  } catch (e) {
    console.error(e);
  }
};
</script>

<style>
.weekday-group { display: flex; flex-wrap: wrap; gap: 15px; }
.weekday-item { display: flex; align-items: center; }
.ml-1 { margin-left: 5px; }
</style>
