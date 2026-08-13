<template>
  <view class="container">
    <view class="header">User Management</view>
    
    <view class="list">
        <view v-for="user in list" :key="user.id" class="item">
            <view class="user-info">
                <text class="username">{{ user.username }}</text>
                <text class="role">{{ user.roles.join(', ') }}</text>
            </view>
            <view class="credit-info">
                <text>Credit: {{ user.credit_balance }}</text>
                <view class="actions">
                    <button size="mini" @click="adjustCredit(user.id, 100)">+100</button>
                    <button size="mini" :type="('warn' as any)" @click="adjustCredit(user.id, -100)">-100</button>
                </view>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { request } from '@/utils/request';

const list = ref<any[]>([]);

const loadData = async () => {
  try {
    const res = await request({ url: '/admin/users' });
    list.value = res as any[];
  } catch (e) {
    console.error(e);
  }
};

const adjustCredit = async (id: string, amount: number) => {
    try {
        await request({
            url: `/admin/users/${id}/credit`,
            method: 'POST',
            data: { amount }
        });
        uni.showToast({ title: 'Success', icon: 'success' });
        loadData();
    } catch (e) {
        console.error(e);
    }
};

onMounted(() => {
  loadData();
});
</script>

<style>
.container { padding: 20px; }
.header { font-size: 24px; font-weight: bold; margin-bottom: 20px; }
.item { border-bottom: 1px solid #eee; padding: 15px 0; display: flex; justify-content: space-between; align-items: center; }
.username { font-weight: bold; font-size: 16px; }
.role { font-size: 12px; color: #999; margin-left: 10px; }
.credit-info { display: flex; flex-direction: column; align-items: flex-end; }
.actions { margin-top: 5px; display: flex; gap: 5px; }
</style>
