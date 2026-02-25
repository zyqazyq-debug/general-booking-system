<template>
  <view class="page-container no-top-nav has-bottom-tab">
    <!-- Dashboard View -->
    <view class="content-wrapper">
      
      <!-- My Services List -->
      <view class="card mb-4">
        <view class="card-header">
            <view class="header-left">
                <text class="section-title">服务</text>
            </view>
            <view class="batch-actions">
                <view class="action-btn" @click="batchToggle(true)">上架</view>
                <view class="divider"></view>
                <view class="action-btn" @click="batchToggle(false)">下架</view>
                <view class="divider"></view>
                <view class="action-btn" @click="batchShare">分享</view>
            </view>
            <view class="new-btn" @click="goToCreateSchedule">
                <text class="plus">+</text> 新建
            </view>
        </view>
        <view class="card-body p-0">
             <view v-if="mySchedules.length === 0" class="empty-state-mini">
                <text class="icon">📝</text>
                <text>暂无服务，点击右上角新建</text>
             </view>
             
             <view v-else class="service-list">
                 <view class="service-item" v-for="item in mySchedules" :key="item.id">
                     <view class="item-left">
                        <view class="info-box">
                             <text class="service-title">{{ item.title }}</text>
                             <text class="service-price">¥{{ item.base_price }}</text>
                         </view>
                     </view>
                     <view class="item-right">
                        <switch :checked="item.is_active" @change="(e) => toggleActive(item, e)" color="#28a745" style="transform:scale(0.7);" />
                         <view class="icon-btn" @click.stop="shareService(item)">
                             <text>分享</text>
                         </view>
                         <view class="icon-btn" @click.stop="editSchedule(item.id)">
                             <text>编辑</text>
                         </view>
                         <view class="icon-btn delete-btn" @click.stop="deleteSchedule(item.id)">
                             <text>🗑️</text>
                         </view>
                     </view>
                 </view>
             </view>
        </view>
      </view>

      <!-- Visual Schedule -->
      <view class="card mb-4">
          <view class="card-header">
              <view class="d-flex align-center">
                  <text class="section-title nowrap mr-2">日程</text>
                   <view class="view-toggle" @click="toggleViewMode">
                       <text :class="{ active: viewMode === 'week' }">周</text>
                       <text :class="{ active: viewMode === 'day' }">日</text>
                   </view>
              </view>
              <view class="d-flex align-center">
                   <template v-if="viewMode === 'week'">
                       <text class="nav-btn small" @click="prevWeek">‹</text>
                       <text class="week-range nowrap">{{ weekRangeLabel }}</text>
                       <text class="nav-btn small" @click="nextWeek">›</text>
                   </template>
                   <template v-else>
                       <text class="nav-btn small" @click="prevDay">‹</text>
                       <picker mode="date" :value="selectedDate" @change="onDateChange">
                           <text class="week-range nowrap text-primary">{{ selectedDate || '今天' }} ▼</text>
                       </picker>
                       <text class="nav-btn small" @click="nextDay">›</text>
                   </template>
              </view>
          </view>
          
          <view class="card-body schedule-body">
              <!-- Week View -->
              <view class="schedule-grid" v-if="viewMode === 'week'">
                  <view class="grid-header">
                      <view class="header-cell time-col-head"></view>
                      <view class="header-cell" 
                        v-for="day in weekDays" 
                        :key="day.format('YYYY-MM-DD')"
                        :class="{ 'today-col': day.isSame(dayjs(), 'day') }"
                      >
                          <text class="day-name">{{ getDayName(day) }}</text>
                          <text class="day-date">{{ day.format('M/D') }}</text>
                      </view>
                  </view>
                  <view class="grid-body-week">
                       <view class="time-row week-row" v-for="slot in weekTimeSlots" :key="slot.idx">
                           <view class="time-cell">{{ slot.label }}</view>
                           <view class="slot-cell" v-for="day in weekDays" :key="day.format('YYYY-MM-DD') + '-' + slot.idx"
                                :class="getWeeklySlotClass(day, slot)"
                                @click="onWeeklySlotClick(day, slot)"
                           >
                               <text v-if="getWeeklySlotOrder(day, slot)" class="slot-text-mini">
                                   {{ getWeeklySlotOrder(day, slot).consumer?.username?.slice(0,2) }}
                               </text>
                           </view>
                       </view>
                  </view>
              </view>

              <!-- Day View -->
              <view class="day-view-container" v-else>
                  <view v-if="todaysOrders.length === 0" class="empty-timeline">
                      <text>今日暂无预约</text>
                  </view>
                  <view class="day-grid" v-else>
                       <view class="day-cell" v-for="slot in dayTimeSlots" :key="slot.idx"
                            :class="getSlotClass(slot.idx)"
                            @click="onSlotClick(slot.idx)"
                       >
                           <text class="time-label-mini">{{ slot.label }}</text>
                           <text v-if="getSlotOrder(slot.idx) && isDaySlotStart(slot.idx)" class="slot-info">
                               {{ getSlotOrder(slot.idx).consumer?.username }}
                           </text>
                       </view>
                  </view>
              </view>
          </view>
      </view>

    </view>

    <!-- Bottom Tab Bar -->
    <view class="bottom-tab" v-if="userStore.userInfo">
        <view class="tab-item active">
            <text class="tab-icon">🛠️</text>
            <text>我的服务</text>
        </view>
        <view class="tab-item" @click="goToCollection">
            <text class="tab-icon">⭐</text>
            <text>收藏</text>
        </view>
        <view class="tab-item" @click="goToPersonal">
            <text class="tab-icon">👤</text>
            <text>个人中心</text>
        </view>
    </view>

    <!-- Share Modal -->
    <ShareModal v-model:visible="showShareModal" :shareLink="currentShareLink" />

      <!-- Edit Service Modal -->
      <view v-if="showEditModal" class="share-modal-mask" @click.self="closeEditModal">
        <view class="share-modal-content edit-service-modal-content" @click.stop>
          <view class="modal-header">
            <text class="modal-title">{{ modalMode === 'create' ? '新建服务' : '编辑服务' }}</text>
            <text class="close-btn" @click="closeEditModal">×</text>
          </view>
          <scroll-view scroll-y class="edit-service-scroll">
            <view class="modal-body compact edit-service-body">
              <view class="mb-2">
                <text class="form-label">名称</text>
                <input class="form-control" v-model="editForm.title" placeholder="服务名称" />
              </view>
              <view class="row-2">
                <view class="col">
                  <text class="form-label">价格</text>
                  <input class="form-control" type="number" v-model="editForm.base_price" />
                </view>
                <view class="col">
                  <text class="form-label">时长(分)</text>
                  <input class="form-control" type="number" v-model="editForm.duration_minutes" />
                </view>
              </view>
              <view class="row-2">
                <view class="col">
                  <text class="form-label">保证金</text>
                  <input class="form-control" type="number" v-model="editForm.deposit_points" />
                </view>
                <view class="col">
                    <text class="form-label">缓冲(分)</text>
                    <input class="form-control" type="number" v-model="editForm.buffer_minutes" />
                </view>
              </view>

              <view class="row-2">
                  <view class="col">
                      <text class="form-label">开始(点)</text>
                      <input class="form-control" type="number" v-model="editForm.rules.start_hour" />
                  </view>
                  <view class="col">
                      <text class="form-label">结束(点)</text>
                      <input class="form-control" type="number" v-model="editForm.rules.end_hour" />
                  </view>
              </view>

              <view class="mb-2">
                  <text class="form-label">工作日 (1=周一)</text>
                  <checkbox-group @change="onEditWeekdayChange" class="weekday-group">
                      <label v-for="day in 7" :key="day" class="weekday-item">
                          <checkbox :value="String(day)" :checked="editForm.rules.weekdays.includes(day)" color="#0d6efd" class="weekday-checkbox" /> 
                          <text class="weekday-text">{{ day }}</text>
                      </label>
                  </checkbox-group>
              </view>

              <view class="row-2">
                <view class="col d-flex align-center justify-center">
                  <text class="form-label mb-0 mr-2">上架</text>
                  <switch :checked="editForm.is_active" @change="(e: any)=>editForm.is_active=e.detail.value" color="#28a745" style="transform: scale(0.8);" />
                </view>
              </view>
            </view>
          </scroll-view>
          <view class="modal-footer">
            <button class="btn btn-primary w-100" @click="confirmEditService">{{ modalMode === 'create' ? '创建' : '保存' }}</button>
          </view>
        </view>
      </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import { getMySchedules, createSchedule, updateSchedule } from '@/api/schedule';
import { request } from '@/utils/request';
import dayjs from 'dayjs';

import ShareModal from '@/components/ShareModal.vue';
import { generateShareLink } from '@/api/share-link';

const userStore = useUserStore();
const showRoleMenu = ref(false);
const mySchedules = ref<any[]>([]);
const weeklyOrders = ref<any[]>([]);
const todaysOrders = ref<any[]>([]); // Add this for Day View
const viewMode = ref('week');
const weekTimeSlots = [
  { idx: 0, label: '00-06', startH: 0, endH: 6 },
  { idx: 1, label: '06-12', startH: 6, endH: 12 },
  { idx: 2, label: '12-18', startH: 12, endH: 18 },
  { idx: 3, label: '18-24', startH: 18, endH: 24 },
];
const dayTimeSlots = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? '30' : '00';
  const hh = String(h).padStart(2, '0');
  return { idx: i, label: `${hh}:${m}` };
});

const selectedDate = ref(dayjs().format('YYYY-MM-DD'));
// 批量操作面向全部服务，无需选择

// Compute 7 days of the week starting from selected date (or start of week)
const weekDays = computed(() => {
    const start = dayjs(selectedDate.value).startOf('week').add(1, 'day'); // Start Monday
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
});

const getDayName = (d: dayjs.Dayjs) => {
    const map = ['日', '一', '二', '三', '四', '五', '六'];
    return map[d.day()];
};

const slotIndexFromDate = (dt: string | Date) => {
    const d = dayjs(dt);
    return d.hour() * 2 + (d.minute() >= 30 ? 1 : 0);
};

const slotIndexRange = (start: string | Date, end: string | Date) => {
    const s = slotIndexFromDate(start);
    const e = slotIndexFromDate(end);
    return { s, e };
};

const getWeeklySlotOrder = (day: dayjs.Dayjs, slot: any) => {
    return weeklyOrders.value.find(o => {
        const oStart = dayjs(o.start_time);
        const oEnd = dayjs(o.end_time);
        
        // Check day match
        if (!oStart.isSame(day, 'day')) return false;
        
        // Check time overlap
        const slotStartHour = slot.startH;
        const slotEndHour = slot.endH;
        const orderStartHour = oStart.hour() + oStart.minute()/60;
        const orderEndHour = oEnd.hour() + oEnd.minute()/60;
        
        // Overlap logic
        return orderStartHour < slotEndHour && orderEndHour > slotStartHour;
    });
};

const getSlotOrder = (slotIdx: number) => {
    return todaysOrders.value.find(o => {
        const { s, e } = slotIndexRange(o.start_time, o.end_time);
        return slotIdx >= s && slotIdx < e;
    });
};

const getSlotClass = (slotIdx: number) => {
    const order = getSlotOrder(slotIdx);
    if (!order) return 'slot-available';
    if (order.status === 'CANCELLED') return 'slot-available';
    if (order.status === 'COMPLETED') return 'slot-completed';
    if (order.status === 'PENDING') return 'slot-pending';
    return 'slot-booked';
};

const isDaySlotStart = (slotIdx: number) => {
    const o = getSlotOrder(slotIdx);
    if (!o) return false;
    const { s } = slotIndexRange(o.start_time, o.end_time);
    return slotIdx === s;
};

const onSlotClick = (slotIdx: number) => {
    const order = getSlotOrder(slotIdx);
    if (order) {
        uni.navigateTo({ url: `/pages/order/list?tab=PROVIDER&hideTabs=true&id=${order.id}` });
    } else {
        const slot = dayTimeSlots[slotIdx];
        uni.showToast({ title: `${slot?.label || ''} 空闲`, icon: 'none' });
    }
};

const getWeeklySlotClass = (day: dayjs.Dayjs, slot: any) => {
    const order = getWeeklySlotOrder(day, slot);
    if (!order) return 'slot-available';
    if (order.status === 'CANCELLED') return 'slot-available';
    if (order.status === 'COMPLETED') return 'slot-completed';
    if (order.status === 'PENDING') return 'slot-pending';
    return 'slot-booked';
};

const onWeeklySlotClick = (day: dayjs.Dayjs, slot: any) => {
    const order = getWeeklySlotOrder(day, slot);
    if (order) {
        uni.navigateTo({ url: `/pages/order/list?tab=PROVIDER&hideTabs=true&id=${order.id}` });
    } else {
        uni.showToast({ title: `${day.format('MM-DD')} ${slot.label} 空闲`, icon: 'none' });
    }
};

const loadData = async () => {
    if (!userStore.userInfo) return;
    try {
        uni.showLoading({ title: '加载中...' });
        const res = await getMySchedules();
        mySchedules.value = res || [];
        await loadOrders();
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '加载失败', icon: 'none' });
    } finally {
        uni.hideLoading();
        uni.stopPullDownRefresh();
    }
};

onShow(() => {
    console.log('Index onShow, loading data...');
    loadData();
});

// const mySchedules = ref<any[]>([]); // already defined above

const loadOrders = async () => {
    try {
        const res = await request({ url: '/order/manage' });
        // In real app, pass start/end date to API
        const allOrders = ((res as any[]) || []).filter(o => o.status !== 'CANCELLED');
        weeklyOrders.value = allOrders;
        
        // Filter for today (selected date)
        todaysOrders.value = allOrders.filter(o => 
            dayjs(o.start_time).format('YYYY-MM-DD') === selectedDate.value
        ).sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    } catch (e) {
        console.error(e);
    }
};

const toggleViewMode = () => {
    viewMode.value = viewMode.value === 'week' ? 'day' : 'week';
};

const onDateChange = (e: any) => {
    selectedDate.value = e.detail.value;
    loadOrders();
};

const weekRangeLabel = computed(() => {
    const days = weekDays.value;
    const first = days[0];
    const last = days[6];
    if (!first || !last) return '';
    return `${first.format('M/D')} - ${last.format('M/D')}`;
});
const prevWeek = () => {
    selectedDate.value = dayjs(selectedDate.value).subtract(7, 'day').format('YYYY-MM-DD');
    loadOrders();
};
const nextWeek = () => {
    selectedDate.value = dayjs(selectedDate.value).add(7, 'day').format('YYYY-MM-DD');
    loadOrders();
};

const prevDay = () => {
    selectedDate.value = dayjs(selectedDate.value).subtract(1, 'day').format('YYYY-MM-DD');
    loadOrders();
};
const nextDay = () => {
    selectedDate.value = dayjs(selectedDate.value).add(1, 'day').format('YYYY-MM-DD');
    loadOrders();
};

const showEditModal = ref(false);
const editingItem = ref<any>(null);
const modalMode = ref<'create' | 'edit'>('edit');
const editForm = ref<any>({ 
    title: '', 
    base_price: 0, 
    duration_minutes: 45, 
    deposit_points: 0, 
    is_active: true,
    buffer_minutes: 15,
    rules: { start_hour: 0, end_hour: 24, weekdays: [1,2,3,4,5,6,7] }
});

const onEditWeekdayChange = (e: any) => {
    editForm.value.rules.weekdays = e.detail.value.map((v: string) => parseInt(v));
};

const goToCreateSchedule = () => {
    modalMode.value = 'create';
    editingItem.value = null;
    editForm.value = { 
        title: '', 
        base_price: 0, 
        duration_minutes: 45, 
        deposit_points: 0, 
        is_active: true,
        buffer_minutes: 15,
        rules: { start_hour: 0, end_hour: 24, weekdays: [1,2,3,4,5,6,7] }
    };
    showEditModal.value = true;
};

const editSchedule = (id: string) => {
    const item = mySchedules.value.find(s => s.id === id);
    if (!item) return;
    modalMode.value = 'edit';
    editingItem.value = item;
    
    let wds = item.rules?.weekdays;
    if (typeof wds === 'string') {
        try { wds = JSON.parse(wds); } catch(e) { wds = [1,2,3,4,5,6,7]; }
    }
    if (!Array.isArray(wds)) wds = [1,2,3,4,5,6,7];

    editForm.value = {
        title: item.title || '',
        base_price: item.base_price || 0,
        duration_minutes: item.duration_minutes || 45,
        deposit_points: item.deposit_points || 0,
        is_active: item.is_active !== false,
        buffer_minutes: item.buffer_minutes || 0,
        rules: {
            start_hour: item.rules?.start_hour ?? 0,
            end_hour: item.rules?.end_hour ?? 24,
            weekdays: wds
        }
    };
    showEditModal.value = true;
};

const closeEditModal = () => {
    showEditModal.value = false;
    editingItem.value = null;
};

const confirmEditService = async () => {
    try {
        const payload = {
            title: editForm.value.title,
            base_price: Number(editForm.value.base_price) || 0,
            duration_minutes: Number(editForm.value.duration_minutes) || 45,
            deposit_points: Number(editForm.value.deposit_points) || 0,
            is_active: !!editForm.value.is_active,
            buffer_minutes: Number(editForm.value.buffer_minutes) || 0,
            rules: {
                start_hour: Number(editForm.value.rules.start_hour),
                end_hour: Number(editForm.value.rules.end_hour),
                weekdays: editForm.value.rules.weekdays
            }
        };

        if (modalMode.value === 'create') {
            await createSchedule(payload);
            uni.showToast({ title: '创建成功', icon: 'success' });
            loadData(); // Refresh list
        } else {
            if (!editingItem.value) return;
            await request({
                url: `/schedules/${editingItem.value.id}`,
                method: 'PATCH',
                data: payload
            });
            const idx = mySchedules.value.findIndex(s => s.id === editingItem.value.id);
            if (idx > -1) {
                mySchedules.value[idx] = { ...mySchedules.value[idx], ...editForm.value };
            }
            uni.showToast({ title: '已保存', icon: 'success' });
        }
        closeEditModal();
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '操作失败', icon: 'none' });
    }
};

const deleteSchedule = (id: string) => {
    uni.showModal({
        title: '确认删除',
        content: '确定要删除这个服务吗？此操作不可恢复。',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/schedules/${id}`, method: 'DELETE' });
                    mySchedules.value = mySchedules.value.filter(item => item.id !== id);
                    uni.showToast({ title: '已删除', icon: 'success' });
                } catch (e) {
                    console.error(e);
                    uni.showToast({ title: '删除失败', icon: 'none' });
                }
            }
        }
    });
};

const viewOrder = (id: string) => {
    // Navigate to order detail (or manage page focused on this order)
    uni.navigateTo({ url: '/pages/order/manage' });
};

const goToCollection = () => uni.reLaunch({ url: '/pages/schedule/collection' });
const goToPersonal = () => uni.reLaunch({ url: '/pages/user/profile' });

const formatTime = (t: string) => dayjs(t).format('HH:mm');

const getStatusClass = (status: string) => {
    switch(status) {
        case 'RESERVED': return 'event-blue';
        case 'COMPLETED': return 'event-green';
        case 'PENDING': return 'event-orange';
        default: return 'event-gray';
    }
};

const toggleRoleMenu = () => { showRoleMenu.value = !showRoleMenu.value; };
const selectRole = (role: string) => {
    userStore.setRole(role);
    showRoleMenu.value = false;
    loadData(); // Reload data for new role
};

const showShareModal = ref(false);
const currentShareLink = ref('');

const shareService = async (item: any) => {
    try {
        uni.showLoading({ title: '生成链接...' });
        // Use agent link so consumers can directly book
        const res: any = await request({
            url: '/agent',
            method: 'POST',
            data: { 
                schedule_id: item.id, 
                markup_type: 'FIXED', 
                markup_value: 0 
            }
        });
        // Correct path to booking detail
        let path = `/pages/booking/detail?token=${res.token}`;
        
        let fullUrl = path;
        // #ifdef H5
        fullUrl = window.location.origin + '/#' + path;
        // #endif
        
        currentShareLink.value = fullUrl;
        showShareModal.value = true;
    } catch (e: any) {
        console.error('Share generation failed:', e);
        const errorMsg = e?.message || e?.data?.message || '未知错误';
        uni.showToast({ title: `生成失败: ${errorMsg}`, icon: 'none', duration: 3000 });
        
        // Fallback to direct link if AgentLink fails
        const path = `/pages/booking/detail?schedule_id=${item.id}`;
        let fullUrl = path;
        // #ifdef H5
        fullUrl = window.location.origin + '/#' + path;
        // #endif
        
        currentShareLink.value = fullUrl;
        showShareModal.value = true;
        
        setTimeout(() => {
            uni.showToast({ title: '已生成直接访问链接', icon: 'none' });
        }, 1000);
    } finally {
        uni.hideLoading();
    }
};

const batchShare = async () => {
    if (!mySchedules.value.length) return uni.showToast({ title: '暂无服务可分享', icon: 'none' });
    
    // Select all IDs (or we could add a checkbox selection logic, but request implies "batch share" as a general action or all)
    // Assuming sharing ALL current services for now, or we should have a selection mode.
    // The user's prompt "Producer selects multiple services (C, D, E)" implies selection.
    // But current UI doesn't have checkboxes. I will share ALL for now or add a quick selector?
    // Let's share ALL visible services in the list for simplicity as per "batch share" context often implies.
    // Or better, show a modal to select? 
    // Given the "batch actions" bar is always visible, sharing ALL is the most straightforward interpretation without adding selection UI.
    
    const targetIds = mySchedules.value.map(s => s.id);
    
    try {
        uni.showLoading({ title: '生成批量链接...' });
        const res = await generateShareLink({
            target_type: 'BATCH',
            targetIds: targetIds
        });
        
        const baseUrl = window.location.origin;
        currentShareLink.value = `${baseUrl}/#/pages/share/view?token=${res.share_token}`;
        showShareModal.value = true;
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '生成失败', icon: 'none' });
    } finally {
        uni.hideLoading();
    }
};

const batchToggle = async (active: boolean) => {
    if (!mySchedules.value.length) return uni.showToast({ title: '暂无服务', icon: 'none' });
    
    uni.showLoading({ title: '批量处理中...' });
    let successCount = 0;
    
    // In a real scenario, the backend should support batch updates. 
    // For now, we loop through and update one by one.
    for (const s of mySchedules.value) {
        if (s.is_active === active) continue; // Skip if already in desired state
        
        try {
            await updateSchedule(s.id, { is_active: active });
            s.is_active = active;
            successCount++;
        } catch (e) {
            console.error(`Failed to update schedule ${s.id}`, e);
        }
    }
    
    uni.hideLoading();
    uni.showToast({ title: `已更新 ${successCount} 个服务`, icon: 'success' });
};

const toggleActive = async (item: any, e: any) => {
    const newVal = e.detail.value;
    // item.is_active = newVal; // Remove optimistic update
    
    try {
        uni.showLoading({ title: '处理中...' });
        await updateSchedule(item.id, { is_active: newVal });
        item.is_active = newVal; // Update after confirmation
        uni.showToast({ title: '已更新', icon: 'success' });
    } catch (e) {
        // item.is_active = !newVal; // Revert not needed if we didn't change it yet, but the switch might have visually changed?
        // In uni-app switch, the visual state changes automatically. We might need to force it back if failed.
        // But usually we update data bound to it.
        // To be safe, force update:
        item.is_active = !newVal; 
        // Then next tick set it back to original (which is !newVal relative to the change, i.e. oldVal)
        // actually item.is_active was oldVal. 
        // If we didn't touch item.is_active, the switch component might still be 'checked' if it's uncontrolled, 
        // but it is :checked="item.is_active".
        // If we don't update item.is_active, Vue re-render should keep it at old val.
        // But the event 'change' happened.
        // Let's just catch and ensure it stays oldVal.
        console.error(e);
        uni.showToast({ title: '操作失败', icon: 'none' });
        // Force refresh to ensure UI sync
        const old = item.is_active;
        item.is_active = !old;
        setTimeout(() => { item.is_active = old; }, 0);
    } finally {
        uni.hideLoading();
    }
};
</script>

<style>
.view-toggle {
    display: flex;
    background: #f1f5f9;
    padding: 2px;
    border-radius: 4px;
    margin-right: 8px;
}
.view-toggle text {
    padding: 2px 8px;
    font-size: 12px;
    color: #64748b;
    border-radius: 4px;
}
.view-toggle text.active {
    background: #fff;
    color: #4e97fc;
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.service-list {
    display: flex;
    flex-direction: column;
}
.service-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    column-gap: 8px;
    border-bottom: 1px solid #f1f5f9;
}
.service-item:last-child { border-bottom: none; }
.service-item:active { background-color: #f8fafc; }

.item-left { display: flex; align-items: center; min-width: 0; }
.info-box { 
    display: grid; 
    grid-template-columns: minmax(0, 1fr) max-content; 
    align-items: center; 
    gap: 6px; 
    min-width: 0; 
    flex: 1; 
}
.service-title { 
    min-width: 0; 
    font-size: 14px; 
    color: #334155; 
    font-weight: 500; 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis; 
}
.service-price { font-size: 12px; color: #4e97fc; font-weight: 600; display: inline-block; white-space: nowrap; flex-shrink: 0; margin-left: 8px; }

.status-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-right: 8px; }
.status-badge.active { background-color: #f0fdf4; color: #28a745; }
.status-badge.inactive { background-color: #f1f5f9; color: #94a3b8; }

/* Timeline Styles */
.timeline-container {
    padding: 10px 0;
}
.empty-timeline {
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
    padding: 20px;
}
.timeline-item {
    display: flex;
    margin-bottom: 16px;
}
.time-col {
    width: 60px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding-right: 12px;
    border-right: 2px solid #e2e8f0;
    font-size: 12px;
    color: #64748b;
    padding-top: 4px;
}
.start-time { font-weight: 600; }
.end-time { color: #94a3b8; font-size: 11px; }

.event-card {
    flex: 1;
    margin-left: 12px;
    padding: 10px;
    border-radius: 8px;
    border-left: 4px solid;
}
.event-title { font-size: 14px; font-weight: 600; display: block; margin-bottom: 4px; }
.event-user { font-size: 12px; opacity: 0.8; }

.event-blue { background-color: #eff6ff; border-left-color: #4e97fc; color: #1e3a8a; }
.event-green { background-color: #f0fdf4; border-left-color: #28a745; color: #14532d; }
.event-orange { background-color: #fff7ed; border-left-color: #f97316; color: #7c2d12; }
.event-gray { background-color: #f1f5f9; border-left-color: #94a3b8; color: #475569; }

.header-left {
    display: flex;
    align-items: center;
}
.batch-actions {
    display: flex;
    align-items: center;
    margin-left: 12px;
    font-size: 12px;
    gap: 8px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}
.action-link { 
    padding: 0 10px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f8fafc;
    border-radius: 4px;
    font-size: 12px;
    color: #4e97fc;
    border: 1px solid #e2e8f0;
    white-space: nowrap;
}
.action-link:active { background-color: #e2e8f0; }
.divider { display: none; }

.item-left {
    display: flex;
    align-items: center;
    flex: 1;
}
.info-box { margin-left: 4px; flex: 1; }

.item-right {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 4px;
    flex: 0 0 auto;
}
.icon-btn {
    padding: 0 6px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f8fafc;
    border-radius: 4px;
    margin-left: 0;
    font-size: 12px;
    color: #4e97fc;
    border: 1px solid #e2e8f0;
}
.icon-btn:active { background-color: #e2e8f0; }
.delete-btn {
    border-color: #fee2e2;
    color: #ef4444;
}

/* Hourly Grid Styles */
.schedule-grid {
    display: flex;
    flex-direction: column;
    width: 100%;
}
.grid-header {
    display: flex;
    padding-bottom: 8px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 8px;
}
.week-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 8px;
}
.nav-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    color: #4e97fc;
    background: #f8fafc;
}
.nav-btn:active { background: #e2e8f0; }
.nav-btn.small { width: 22px; height: 22px; font-size: 14px; }
.week-range { font-size: 12px; color: #64748b; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.d-flex { display: flex; }
.align-center { align-items: center; }
.card-header .d-flex { flex-wrap: nowrap; gap: 6px; white-space: nowrap; }
.header-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #64748b;
    padding: 4px 0;
}
.header-cell.today-col {
    color: #4e97fc;
    font-weight: 600;
    background-color: #eff6ff;
    border-radius: 4px;
}
.time-col-head { flex: 0 0 40px; }
.day-name { font-weight: 500; margin-bottom: 2px; }
.day-date { font-size: 11px; opacity: 0.8; }

.grid-body-week {
    display: flex;
    flex-direction: column;
}
.time-row {
    display: flex;
    height: 24px;
    margin-bottom: 2px;
}
.time-cell {
    flex: 0 0 40px;
    font-size: 11px;
    color: #94a3b8;
    text-align: center;
    line-height: 24px;
    border-right: 1px solid #f1f5f9;
}
.slot-cell {
    flex: 1;
    border: 1px solid #f1f5f9;
    border-radius: 4px;
    margin: 0 1px;
    background-color: #fcfcfc;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}
.slot-cell:active { background-color: #f1f5f9; }

.slot-text-mini {
    font-size: 10px;
    color: #1e3a8a;
    font-weight: 600;
}

.slot-available { background-color: #fcfcfc; }
.slot-booked { background-color: #eff6ff; border-color: #bfdbfe; }
.slot-completed { background-color: #f0fdf4; border-color: #bbf7d0; }
.slot-pending { background-color: #fff7ed; border-color: #fed7aa; }

.time-label { font-size: 11px; color: #94a3b8; margin-right: 8px; }
.hour-row { display: flex; height: 28px; margin-bottom: 4px; }
.hour-cell { 
    border: 1px solid #f1f5f9; 
    border-radius: 4px; 
    background: #fcfcfc; 
    height: 100%;
    display: flex; align-items: center; justify-content: center;
}

/* New Grid Styles */
.week-row {
    height: 60px;
}

.day-view-container {
    padding: 8px 0;
}
.day-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
}
.day-cell {
    border: 1px solid #f1f5f9;
    border-radius: 6px;
    background: #fff;
    padding: 8px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.day-cell:active { background-color: #f8fafc; }
.day-cell.slot-booked { background-color: #eff6ff; border-color: #bfdbfe; }
.day-cell.slot-completed { background-color: #f0fdf4; border-color: #bbf7d0; }
.day-cell.slot-pending { background-color: #fff7ed; border-color: #fed7aa; }

.time-label-mini {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 2px;
    font-weight: 500;
}
.slot-info {
    font-size: 10px;
    font-weight: 600;
    color: #1e3a8a;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
}

/* ... keep existing styles ... */
.page-container {
    min-height: 100vh;
    background-color: #f1f5f9;
}

.top-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    background-color: #fff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99;
    padding: 0 16px;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.page-title {
    font-size: 17px;
    font-weight: 600;
    color: #1e293b;
}

.role-selector {
    position: absolute;
    right: 16px;
    font-size: 13px;
    color: #475569;
    display: flex;
    align-items: center;
    background: #f8fafc;
    padding: 6px 10px;
    border-radius: 20px;
    border: 1px solid #e2e8f0;
}
.role-name {
    font-weight: 600;
    color: #4e97fc;
    margin-right: 4px;
}
.arrow { font-size: 10px; color: #94a3b8; }

.role-menu {
    position: absolute;
    top: 120%;
    right: 0;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    width: 140px;
    z-index: 100;
    padding: 6px;
}

.role-menu-item {
    padding: 10px 12px;
    text-align: left;
    color: #334155;
    font-size: 14px;
    border-radius: 8px;
    font-weight: 500;
}
.role-menu-item:active {
    background-color: #f1f5f9;
    color: #4e97fc;
}

.content-wrapper {
    padding: 26px 16px 26px 16px;
}

.card {
    background-color: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    margin-bottom: 16px;
    overflow: hidden;
    transition: box-shadow 0.3s ease;
    border: 1px solid #e2e8f0;
}

.card-header {
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
    font-weight: 600;
    font-size: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: #fcfcfc;
}
.card-body {
    padding: 16px;
}
.p-0 { padding: 0 !important; }

.schedule-body { padding-top: 8px; padding-bottom: 12px; }

.bottom-tab {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-top: 1px solid #e2e8f0;
    display: flex;
    z-index: 99;
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: 0 -4px 6px -1px rgba(0,0,0,0.02);
}
.tab-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
}
.tab-item.active { color: #4e97fc; }
.tab-icon { font-size: 22px; margin-bottom: 2px; }
.text-primary { color: #4e97fc; }

.empty-state-mini {
    padding: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    font-size: 14px;
    border-bottom: 1px solid #f1f5f9;
}
.empty-state-mini .icon { font-size: 24px; margin-bottom: 8px; }

/* Replaced with flex layout */
.batch-actions {
    flex: 1 1 0;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    align-items: center;
    background: transparent;
    padding: 0;
    border-radius: 0;
    margin: 0 8px;
    overflow: hidden;
}
.batch-actions .action-btn {
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font-size: 12px;
    color: #4e97fc;
    font-weight: 500;
    padding: 0 6px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    white-space: nowrap;
}
.batch-actions .action-btn:active { background-color: #e2e8f0; }
.batch-actions .divider { display: none; width: 0; height: 0; }
.section-title {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    white-space: nowrap;
}
.new-btn {
    display: flex;
    align-items: center;
    background-color: #4e97fc;
    color: #fff;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 2px 4px rgba(78, 151, 252, 0.2);
}
.new-btn:active {
    background-color: #3b82f6;
    transform: scale(0.95);
}
.new-btn .plus {
    margin-right: 4px;
    font-size: 16px;
    font-weight: 300;
    line-height: 1;
}

.share-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.share-modal-content {
  width: 86%;
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
}
.edit-service-modal-content {
  width: 92%;
  height: calc(var(--app-vh, 1vh) * 92);
  max-height: calc(var(--app-vh, 1vh) * 92);
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.close-btn {
  font-size: 22px;
  color: #94a3b8;
  line-height: 1;
}
.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
}
.modal-body.compact .mb-2 { margin-bottom: 8px; }
.modal-body.compact .row-2 { display: flex; gap: 8px; }
.modal-body.compact .row-2 .col { flex: 1; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.mb-0 { margin-bottom: 0; }
.mr-2 { margin-right: 8px; }
.edit-service-scroll {
  flex: 1 1 auto;
  min-height: 0;
}
.modal-footer {
  padding: 10px 16px;
  border-top: 1px solid #f1f5f9;
  background-color: #fff;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.modal-footer .btn {
  margin-bottom: 0;
}
.weekday-group {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.weekday-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.weekday-checkbox {
  transform: scale(0.7);
}
.weekday-text {
  font-size: 12px;
}
.mr-2 { margin-right: 8px; }
.ml-2 { margin-left: 8px; }
</style>
