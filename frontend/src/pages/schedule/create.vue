<template>
  <view class="container">
    <view class="header">Create Schedule</view>
    
    <view class="form-item">
      <text class="label">Title</text>
      <input v-model="form.title" class="input" placeholder="e.g. Piano Lesson" />
    </view>
    
    <view class="form-row">
        <view class="form-item half">
          <text class="label">Base Price</text>
          <input v-model="form.base_price" class="input" type="number" placeholder="0.00" />
        </view>
        <view class="form-item half">
          <text class="label">Deposit Points</text>
          <input v-model="form.deposit_points" class="input" type="number" placeholder="0" />
        </view>
    </view>
    
    <view class="form-row">
        <view class="form-item half">
          <text class="label">Duration (min)</text>
          <input v-model="form.duration_minutes" class="input" type="number" placeholder="60" />
        </view>
        <view class="form-item half">
          <text class="label">Buffer (min)</text>
          <input v-model="form.buffer_minutes" class="input" type="number" placeholder="0" />
        </view>
    </view>
    
    <view class="section-title">Availability Rules</view>
    <view class="form-row">
        <view class="form-item half">
            <text class="label">Start Hour</text>
            <input v-model="rules.start_hour" class="input" type="number" placeholder="9" />
        </view>
        <view class="form-item half">
            <text class="label">End Hour</text>
            <input v-model="rules.end_hour" class="input" type="number" placeholder="17" />
        </view>
    </view>
    <view class="form-item">
        <text class="label">Weekdays (1=Mon, 7=Sun)</text>
        <checkbox-group @change="onWeekdayChange">
            <label v-for="day in 7" :key="day" class="checkbox-label">
                <checkbox :value="String(day)" :checked="rules.weekdays.includes(day)" /> {{ day }}
            </label>
        </checkbox-group>
    </view>
    
    <button type="button" class="submit-btn primary" @click="submit">Create Schedule</button>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { createService } from '@/domains/provider';
import { useUserStore } from '@/shared/stores/user';

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
    start_hour: 9,
    end_hour: 17,
    weekdays: [1, 2, 3, 4, 5]
});

const onWeekdayChange = (e: any) => {
    rules.weekdays = e.detail.value.map((v: string) => parseInt(v));
};

const submit = async () => {
  try {
    if(!form.title) return uni.showToast({ title: 'Title required', icon: 'none' });
    
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
    
    await createService(payload);
    uni.showToast({ title: 'Created!', icon: 'success' });
    setTimeout(() => {
        uni.navigateBack();
    }, 1500);
  } catch (e) {
    console.error(e);
  }
};
</script>

<style>
.container { padding: 20px; }
.header { font-size: 24px; font-weight: bold; margin-bottom: 20px; text-align: center; }
.form-item { margin-bottom: 20px; }
.form-row { display: flex; justify-content: space-between; gap: 10px; }
.half { flex: 1; }
.label { font-size: 14px; color: #666; margin-bottom: 5px; display: block; }
.input { border: 1px solid #ddd; padding: 10px; border-radius: 4px; background: #fff; }
.section-title { font-weight: bold; margin-top: 20px; margin-bottom: 10px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
.checkbox-label { margin-right: 15px; display: inline-block; margin-bottom: 10px; }
.submit-btn { margin-top: 30px; }
</style>
