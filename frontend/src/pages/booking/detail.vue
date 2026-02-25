<template>
  <view class="page-container" v-if="schedule">
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">预约详情</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <view class="card">
            <view class="card-header">
                <text class="card-title">{{ schedule.title }}</text>
            </view>
            <view class="card-body">
                 <view class="info-row mb-3">
                    <text class="label">价格:</text> 
                    <text class="value text-primary fw-bold">¥{{ displayPrice }}</text>
                 </view>
                 <view class="info-row mb-4">
                    <text class="label">时长:</text> 
                    <text class="value">{{ schedule.duration_minutes }} 分钟</text>
                 </view>
                 <view class="info-row mb-4">
                    <text class="label">工作日:</text> 
                    <text class="value">{{ weekdayRuleText }}</text>
                 </view>
                 
                 <view class="form-group mb-4">
                    <text class="form-label">选择日期</text>
                    <picker mode="date" :start="today" :end="maxDate" @change="onDateChange">
                        <view class="form-control picker-box">
                            <text v-if="selectedDate">{{ selectedDate }}</text>
                            <text v-else class="placeholder">点击选择日期</text>
                            <text class="icon">📅</text>
                        </view>
                    </picker>
                 </view>
                 
                 <view v-if="selectedDate" class="slots-section">
                     <text class="form-label mb-3">选择时间段</text>
                     
                     <view v-if="loadingSlots" class="status-msg">
                         <text>加载中...</text>
                     </view>
                     
                     <view v-else-if="slots.length === 0" class="status-msg">
                         <text>该日期暂无可用时段</text>
                     </view>
                     
                     <view class="slot-grid" v-else>
                        <view 
                            v-for="slot in slots" 
                            :key="slot.start_time" 
                            class="slot-item"
                            :class="{ 
                                'selected': selectedSlot?.start_time === slot.start_time,
                                'booked': slot.status !== 'available'
                            }"
                            @click="selectSlot(slot)"
                        >
                            {{ formatTime(slot.start_time) }}
                        </view>
                    </view>
                 </view>
            </view>
        </view>
        
        <view class="fixed-footer">
            <button class="btn btn-primary" :disabled="!selectedSlot" @click="confirmBooking">
                确认预约
            </button>
        </view>
    </view>
  </view>
  <view v-else class="page-container center-content">
      <text class="loading-text">加载中...</text>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from "@dcloudio/uni-app";
import { resolveAgentLink } from '@/api/agent';
import { request } from '@/utils/request';
import { useUserStore } from '@/stores/user';
import dayjs from 'dayjs';

const userStore = useUserStore();
const schedule = ref<any>(null);
const agentLinkToken = ref('');
const agencyNodeId = ref('');
const displayPrice = ref(0);
const selectedDate = ref('');
const slots = ref<any[]>([]);
const selectedSlot = ref<any>(null);
const loadingSlots = ref(false);

const today = dayjs().format('YYYY-MM-DD');
const maxDate = dayjs().add(30, 'day').format('YYYY-MM-DD');

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const normalizeWeekdays = (wds: unknown): number[] => {
    if (!wds) return [];
    let v: any = wds;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { v = []; }
    }
    if (!Array.isArray(v)) return [];
    return v
        .map((x: any) => Number(x))
        .filter((n: any) => Number.isFinite(n) && n >= 1 && n <= 7);
};
const weekdayRuleText = computed(() => {
    const wds = normalizeWeekdays(schedule.value?.rules?.weekdays);
    if (wds.length === 0) return '未设置';
    const uniq = Array.from(new Set(wds)).sort((a, b) => a - b);
    if (uniq.length === 7) return '每天';
    return uniq.map((d) => weekdayNames[d - 1]).join('、');
});

onLoad(async (options: any) => {
    if (options.token) {
        agentLinkToken.value = options.token;
        const res = await resolveAgentLink(options.token);
        schedule.value = res.schedule;
        displayPrice.value = res.schedule.base_price;
        if (res.parentNodeId) {
            agencyNodeId.value = res.parentNodeId;
        }
    } else if (options.slug) {
        // Resolve fixed slug
        const res: any = await request({ url: `/agent/s/${options.slug}` });
        schedule.value = res.schedule;
        displayPrice.value = res.schedule.base_price;
        agencyNodeId.value = res?.importInfo?.parentNodeId || '';
    } else if (options.schedule_id) {
        const res = await request({ url: `/schedules/${options.schedule_id}` });
        schedule.value = res;
        displayPrice.value = res.base_price;
    } else if (options.agency_node_id) {
        // Handle booking via Collection (Agency Node)
        const res: any = await request({ url: `/agency/nodes/${options.agency_node_id}` });
        schedule.value = { ...res.service, title: res.alias || res.service.title };
        // Use cached total price (Selling Price)
        displayPrice.value = res.cache_total_price;
        agencyNodeId.value = res.id;
    }
    // Set default date to today and fetch slots
    selectedDate.value = today;
    await fetchSlots();
});

const onDateChange = async (e: any) => {
    selectedDate.value = e.detail.value;
    selectedSlot.value = null;
    await fetchSlots();
};

const fetchSlots = async () => {
    if (!schedule.value || !selectedDate.value) return;
    loadingSlots.value = true;
    try {
        const res = await request({ 
            url: `/schedules/${schedule.value.id}/slots?date=${selectedDate.value}`,
            method: 'GET'
        });
        slots.value = res as any[];
    } catch (e) {
        console.error(e);
    } finally {
        loadingSlots.value = false;
    }
};

const selectSlot = (slot: any) => {
    if (slot.status !== 'available') return; // Prevent selection of booked slots
    selectedSlot.value = slot;
};

const formatTime = (iso: string) => dayjs(iso).format('HH:mm');
const goBack = () => uni.navigateBack();

const confirmBooking = () => {
    if (!userStore.userInfo) {
        uni.navigateTo({ url: '/pages/login/login' });
        return;
    }
    
    uni.showModal({
        title: '确认预约',
        content: `确认预约 ${schedule.value.title}\n工作日: ${weekdayRuleText.value}\n时间: ${selectedDate.value} ${formatTime(selectedSlot.value.start_time)}?`,
        success: (res) => {
            if (res.confirm) {
                submitBooking();
            }
        }
    });
};

const submitBooking = async () => {
    try {
        const orderData: any = {
            schedule_id: schedule.value.id,
            consumer_id: userStore.userInfo.id,
            start_time: selectedSlot.value.start_time,
            end_time: selectedSlot.value.end_time,
        };
        
        // Pass agent link token if present
        if (agentLinkToken.value) {
            orderData.agent_link_token = agentLinkToken.value;
        }
        
        // Pass agency node id if present
        if (agencyNodeId.value) {
            orderData.agency_node_id = agencyNodeId.value;
        }
        
        await request({
            url: '/order',
            method: 'POST',
            data: orderData
        });
        
        uni.showToast({ title: '预约成功!', icon: 'success' });
        setTimeout(() => {
            // Redirect to Collection page instead of Order list
            uni.reLaunch({ url: '/pages/schedule/collection' });
        }, 1500);
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '预约失败', icon: 'none' });
    }
};
</script>

<style>
.card-title {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
}

.info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 12px;
}
.info-row:last-child { border-bottom: none; }
.info-row .label { color: #64748b; }
.info-row .value { color: #334155; font-weight: 500; }

.picker-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #334155;
}
.placeholder { color: #94a3b8; }
.icon { font-size: 16px; }

.slots-section {
    margin-top: 24px;
    border-top: 1px solid #e2e8f0;
    padding-top: 20px;
}

.status-msg {
    text-align: center;
    padding: 20px;
    color: #94a3b8;
    font-size: 14px;
}

.slot-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
}

.slot-item {
    height: 36px; /* 纵向压缩高度: 40px -> 36px */
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px; /* 微调圆角 */
    font-size: 13px; /* 微调字体大小 */
    color: #334155;
    transition: all 0.2s;
    position: relative;
    overflow: hidden;
}

.slot-item.selected {
    background-color: #4e97fc;
    color: #fff;
    border-color: #4e97fc;
    box-shadow: 0 4px 6px -1px rgba(78, 151, 252, 0.3);
}

.slot-item.booked {
    background-color: #f1f5f9;
    color: #cbd5e1;
    border-color: #f1f5f9;
    cursor: not-allowed;
    text-decoration: line-through;
}

.fixed-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 16px;
    background: #fff;
    border-top: 1px solid #e2e8f0;
    z-index: 10;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.content-wrapper {
    padding-bottom: 100px; /* Space for footer */
}

.loading-text {
    color: #94a3b8;
    font-size: 14px;
}
</style>
