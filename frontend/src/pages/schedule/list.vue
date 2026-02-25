<template>
  <view class="page-container">
    <!-- Top Nav -->
    <view class="top-nav">
       <view class="nav-left" @click="goBack">
          <text class="arrow-left">←</text>
       </view>
       <text class="page-title">{{ pageTitle }}</text>
       <view class="nav-right"></view>
    </view>

    <view class="content-wrapper">
        <!-- Filter Bar -->
        <view class="filter-bar">
            <input class="form-control search-input" v-model="keyword" placeholder="搜索服务..." confirm-type="search" @confirm="onSearch" />
        </view>

        <!-- Owner: Add Button -->
        <button v-if="userStore.currentRole === 'OWNER'" class="btn btn-primary mb-4 shadow-btn" @click="goToCreate">
            <text class="plus-icon">+</text> 新建日程
        </button>

        <!-- List -->
        <view class="schedule-list">
            <view v-if="list.length === 0" class="empty-state">
                <text class="empty-icon">📅</text>
                <text class="empty-text">暂无数据</text>
            </view>
            
            <view class="card schedule-card" v-for="item in list" :key="item.id">
                <view class="card-body">
                    <view class="card-top">
                        <view class="info-main">
                            <h6 class="schedule-title">{{ item.title }}</h6>
                            <view class="meta-row">
                                <span v-if="item.owner" class="source-tag">商家: {{ item.owner.username }}</span>
                                <span :class="['status-dot', item.is_active ? 'active' : 'inactive']"></span>
                                <text class="status-text">{{ item.is_active ? '已上架' : '已下架' }}</text>
                            </view>
                        </view>
                        <view class="price-box">
                            <text class="currency">¥</text>
                            <text class="amount">{{ item.base_price }}</text>
                        </view>
                    </view>
                    
                    <view class="card-middle">
                        <view class="info-item">
                            <text class="icon">⏱️</text>
                            <text>{{ item.duration_minutes }} 分钟</text>
                        </view>
                        <view class="info-item" v-if="item.rules">
                            <text class="icon">🕒</text>
                            <text>{{ item.rules.start_hour }}:00 - {{ item.rules.end_hour }}:00</text>
                        </view>
                    </view>

                    <view class="card-actions">
                        <!-- Owner Actions -->
                        <template v-if="isOwnerMode || (item.owner && userStore.userInfo && item.owner.id === userStore.userInfo.id)">
                            <button class="btn btn-sm btn-outline-primary action-btn" @click="openEdit(item.id)">编辑</button>
                        </template>

                        <!-- Agent/Collection Actions -->
                        <template v-else>
                            <button class="btn btn-sm btn-outline-primary action-btn" @click="createAgentLink(item.id)">
                                推广
                            </button>
                            <button class="btn btn-sm btn-primary action-btn book-btn" @click="book(item.id)">
                                预约
                            </button>
                        </template>
                    </view>
                </view>
            </view>
        </view>
        <view v-if="showEdit" class="modal-mask" @click="closeEdit">
          <view class="modal-content" @click.stop>
            <view class="modal-header">
            <text>{{ modalMode === 'create' ? '新建服务' : '编辑服务' }}</text>
            <text class="close-x" @click="closeEdit">×</text>
          </view>
            <view>
              <text class="form-label">标题</text>
              <input class="form-control" v-model="editForm.title" placeholder="服务标题" />
              <view class="row-2col">
                <view class="col">
                  <text class="form-label">价格(元)</text>
                  <input class="form-control" type="number" v-model="editForm.base_price" />
                </view>
                <view class="col">
                  <text class="form-label">时长(分钟)</text>
                  <input class="form-control" type="number" v-model="editForm.duration_minutes" />
                </view>
              </view>
              
              <view class="row-2col">
                  <view class="col">
                      <text class="form-label">缓冲(分钟)</text>
                      <input class="form-control" type="number" v-model="editForm.buffer_minutes" />
                  </view>
                  <view class="col">
                    <text class="form-label">所需积分</text>
                    <input class="form-control" type="number" v-model="editForm.deposit_points" />
                  </view>
              </view>

              <view class="row-2col">
                  <view class="col">
                      <text class="form-label">开始时间(点)</text>
                      <input class="form-control" type="number" v-model="editForm.rules.start_hour" />
                  </view>
                  <view class="col">
                      <text class="form-label">结束时间(点)</text>
                      <input class="form-control" type="number" v-model="editForm.rules.end_hour" />
                  </view>
              </view>

              <view style="margin-bottom:12px;">
                  <text class="form-label">工作日 (1=周一)</text>
                  <checkbox-group @change="onEditWeekdayChange" class="weekday-group">
                      <label v-for="day in 7" :key="day" class="weekday-item">
                          <checkbox :value="String(day)" :checked="editForm.rules.weekdays.includes(day)" color="#0d6efd" style="transform:scale(0.8)" /> 
                          <text class="ml-1">{{ day }}</text>
                      </label>
                  </checkbox-group>
              </view>

              <view class="row-2col">
                <view class="col" style="display:flex;align-items:flex-end;">
                  <label style="display:flex;align-items:center;width:100%;">
                    <switch :checked="editForm.is_active" @change="(e: any)=> editForm.is_active = e.detail.value" style="transform:scale(0.8);margin-right:6px;" />
                    <text>上架</text>
                  </label>
                </view>
              </view>
              <button class="btn btn-primary" @click="saveEdit">{{ modalMode === 'create' ? '创建' : '保存' }}</button>
            </view>
          </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue';
import { getMySchedules, getSchedules, createSchedule } from '@/api/schedule';
import { useUserStore } from '@/stores/user';
import { onLoad } from '@dcloudio/uni-app';
import { request } from '@/utils/request';

const userStore = useUserStore();
const list = ref<any[]>([]);
const keyword = ref('');
const filterType = ref('');

onLoad((options: any) => {
    filterType.value = options.filter || '';
});

const isOwnerMode = computed(() => filterType.value === 'my');

const pageTitle = computed(() => {
    if (isOwnerMode.value) return '服务管理';
    return '服务收藏';
});

const loadData = async () => {
  try {
    if (isOwnerMode.value) {
        list.value = (await getMySchedules()) as any[];
    } else {
        // In real app, this should be getMyCollection()
        // For now, reuse getSchedules but filter or mock
        list.value = (await getSchedules()) as any[]; 
    }
  } catch (e) {
    console.error(e);
  }
};

const onSearch = () => {
    // Simple client-side filter for now
    if (!keyword.value) {
        loadData();
        return;
    }
    list.value = list.value.filter(item => 
        item.title.toLowerCase().includes(keyword.value.toLowerCase())
    );
};

const goBack = () => uni.navigateBack();

const createAgentLink = (id: string) => {
  uni.navigateTo({ url: `/pages/agent/create-link?schedule_id=${id}` });
};

const book = (id: string) => {
    uni.navigateTo({ url: `/pages/booking/detail?schedule_id=${id}` });
};

// Edit Modal State
const showEdit = ref(false);
const editingId = ref<string>('');
const modalMode = ref<'create' | 'edit'>('edit');
const editForm = reactive<any>({
    title: '',
    base_price: 0,
    deposit_points: 0,
    duration_minutes: 45,
    is_active: true,
    buffer_minutes: 15,
    rules: {
        start_hour: 0,
        end_hour: 24,
        weekdays: [1,2,3,4,5,6,7]
    }
});

const onEditWeekdayChange = (e: any) => {
    editForm.rules.weekdays = e.detail.value.map((v: string) => parseInt(v));
};

const goToCreate = () => {
  modalMode.value = 'create';
  editingId.value = '';
  editForm.title = '';
  editForm.base_price = 0;
  editForm.deposit_points = 0;
  editForm.duration_minutes = 45;
  editForm.is_active = true;
  editForm.buffer_minutes = 15;
  editForm.rules.start_hour = 0;
  editForm.rules.end_hour = 24;
  editForm.rules.weekdays = [1,2,3,4,5,6,7];
  showEdit.value = true;
};

const openEdit = (id: string) => {
    const item = list.value.find(i => i.id === id);
    if (!item) return;
    modalMode.value = 'edit';
    editingId.value = id;
    editForm.title = item.title || '';
    editForm.base_price = item.base_price || 0;
    editForm.deposit_points = item.deposit_points || 0;
    editForm.duration_minutes = item.duration_minutes || 45;
    editForm.buffer_minutes = item.buffer_minutes || 0;
    // Ensure boolean
    editForm.is_active = !!item.is_active;

    if (item.rules) {
        editForm.rules.start_hour = item.rules.start_hour !== undefined ? item.rules.start_hour : 0;
        editForm.rules.end_hour = item.rules.end_hour !== undefined ? item.rules.end_hour : 24;
        
        let wds = item.rules.weekdays;
        if (typeof wds === 'string') {
            try { wds = JSON.parse(wds); } catch(e) { wds = [1,2,3,4,5,6,7]; }
        }
        if (!Array.isArray(wds)) wds = [1,2,3,4,5,6,7];
        editForm.rules.weekdays = wds;
    } else {
        editForm.rules.start_hour = 0;
        editForm.rules.end_hour = 24;
        editForm.rules.weekdays = [1,2,3,4,5,6,7];
    }

    showEdit.value = true;
};

const closeEdit = () => { showEdit.value = false; };

const saveEdit = async () => {
    try {
        const payload = {
            title: editForm.title,
            base_price: Number(editForm.base_price),
            deposit_points: Number(editForm.deposit_points),
            duration_minutes: Number(editForm.duration_minutes),
            buffer_minutes: Number(editForm.buffer_minutes),
            is_active: Boolean(editForm.is_active),
            rules: {
                start_hour: Number(editForm.rules.start_hour),
                end_hour: Number(editForm.rules.end_hour),
                weekdays: editForm.rules.weekdays
            }
        };
        console.log('Saving payload:', payload);

        if (modalMode.value === 'create') {
             await createSchedule({ ...payload, owner_id: userStore.userInfo?.id });
             uni.showToast({ title: '创建成功', icon: 'success' });
             loadData(); // Refresh list
        } else {
            const res: any = await request({ url: `/schedules/${editingId.value}`, method: 'PATCH', data: payload });
            console.log('Save response:', res);
            
            // Update list with response data
            const idx = list.value.findIndex(i => i.id === editingId.value);
            if (idx > -1) {
                // Merge response data if available, otherwise fallback to payload
                list.value[idx] = { ...list.value[idx], ...res };
            }
            uni.showToast({ title: '已保存', icon: 'success' });
        }
        closeEdit();
    } catch (e) {
        console.error('Save failed:', e);
        uni.showToast({ title: '操作失败', icon: 'none' });
    }
};

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.nav-left {
    position: absolute;
    left: 15px;
    font-size: 24px;
    padding: 10px;
}
.nav-right { width: 40px; }
.arrow-left { font-weight: bold; }

.search-input {
    background-color: #fff;
    border-radius: 24px;
    border: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    height: 44px;
    padding-left: 20px;
}

.shadow-btn {
    box-shadow: 0 4px 12px rgba(78, 151, 252, 0.3);
    border-radius: 12px;
    font-size: 16px;
    height: 52px;
    margin-bottom: 24px;
}
.plus-icon { font-size: 18px; margin-right: 6px; }

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #94a3b8;
}
.empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
.empty-text { font-size: 16px; }

.schedule-card {
    border: none;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    border-radius: 16px;
    margin-bottom: 20px;
}

.card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
}

.schedule-title {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 6px;
}

.meta-row {
    display: flex;
    align-items: center;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
}
.status-dot.active { background-color: #28a745; }
.status-dot.inactive { background-color: #cbd5e1; }

.status-text {
    font-size: 12px;
    color: #64748b;
}

.price-box {
    display: flex;
    align-items: baseline;
    color: #4e97fc;
}
.currency { font-size: 14px; font-weight: 600; margin-right: 2px; }
.amount { font-size: 24px; font-weight: 800; line-height: 1; }

.card-middle {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid #f1f5f9;
}

.info-item {
    display: flex;
    align-items: center;
    color: #475569;
    font-size: 13px;
    background-color: #f8fafc;
    padding: 6px 12px;
    border-radius: 8px;
}
.info-item .icon { margin-right: 6px; font-size: 14px; }

.card-actions {
    display: flex;
    justify-content: flex-end;
}

.action-btn {
    min-width: 100px;
    height: 40px;
    font-weight: 600;
    margin-left: 10px;
}
.book-btn {
    background-color: #1e293b;
    border-color: #1e293b;
    color: #fff;
    box-shadow: 0 4px 6px -1px rgba(30, 41, 59, 0.3);
}

/* Edit Modal */
.modal-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
}
.modal-content {
    background: #fff;
    width: 88%;
    border-radius: 12px;
    overflow: hidden;
    padding: 16px;
    border: 1px solid #e2e8f0;
}
.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    font-size: 16px;
    margin-bottom: 12px;
}
.close-x { font-size: 22px; color: #94a3b8; line-height: 1; }
.row-2col { display: flex; gap: 10px; }
.row-2col .col { flex: 1; }

.weekday-group { display: flex; flex-wrap: wrap; gap: 15px; }
.weekday-item { display: flex; align-items: center; }
.ml-1 { margin-left: 5px; }
</style>
