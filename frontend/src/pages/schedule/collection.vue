<template>
  <view class="page-container no-top-nav has-bottom-tab">

    <view class="content-wrapper">
        <view class="filter-bar mb-3">
            <view class="search-actions">
                <view class="search-input-wrap">
                    <input class="form-control search-input" v-model="keyword" placeholder="筛选" confirm-type="search" @confirm="onSearch" @input="onSearch" />
                </view>
                <view class="filter-icon-btn" @click="showFilter = !showFilter">
                    <text :class="{'active-filter': showFilter}">⚙️</text>
                </view>
                <view class="import-btn" @click="showImport = true">
                    <text class="import-text">导入</text>
                </view>
            </view>
        </view>

        <!-- Filter Options Panel -->
        <view v-if="showFilter" class="filter-panel mb-3">
            <view class="filter-row">
                <text class="filter-label">价格范围</text>
                <view class="filter-inputs">
                    <input type="number" class="form-control filter-input" v-model="filterPrice.min" placeholder="最低价" />
                    <text class="separator">-</text>
                    <input type="number" class="form-control filter-input" v-model="filterPrice.max" placeholder="最高价" />
                </view>
            </view>
            <view class="filter-row mt-2">
                <text class="filter-label">时间范围</text>
                <view class="datetime-grid">
                    <view class="datetime-col">
                        <picker class="datetime-picker" mode="date" :value="filterDate.start_date" @change="onStartDateChange">
                            <view :class="['form-control', 'picker-input', !filterDate.start_date && 'picker-placeholder']">{{ filterDate.start_date || '开始日期' }}</view>
                        </picker>
                        <picker class="datetime-picker" mode="time" :value="filterDate.start_time" @change="onStartTimeChange">
                            <view :class="['form-control', 'picker-input', !filterDate.start_time && 'picker-placeholder']">{{ filterDate.start_time || '开始时间' }}</view>
                        </picker>
                    </view>
                    <text class="datetime-sep">至</text>
                    <view class="datetime-col">
                        <picker class="datetime-picker" mode="date" :value="filterDate.end_date" @change="onEndDateChange">
                            <view :class="['form-control', 'picker-input', !filterDate.end_date && 'picker-placeholder']">{{ filterDate.end_date || '结束日期' }}</view>
                        </picker>
                        <picker class="datetime-picker" mode="time" :value="filterDate.end_time" @change="onEndTimeChange">
                            <view :class="['form-control', 'picker-input', !filterDate.end_time && 'picker-placeholder']">{{ filterDate.end_time || '结束时间' }}</view>
                        </picker>
                    </view>
                </view>
            </view>
            <view class="filter-actions mt-3">
                <button class="btn btn-sm btn-outline-secondary w-100" @click="resetFilter">重置筛选</button>
            </view>
        </view>

        <view class="schedule-list">
            <view v-if="filteredList.length === 0" class="empty-state">
                <text class="empty-icon">⭐</text>
                <text class="empty-text">{{ list.length === 0 ? '暂无收藏的服务' : '无匹配结果' }}</text>
                <button v-if="list.length === 0" class="btn btn-sm btn-outline-primary mt-3" @click="goBack">去浏览</button>
            </view>
            
            <view class="card schedule-card" v-for="item in filteredList" :key="item.id">
                <view class="card-body compact">
                    <view class="card-top">
                        <view class="info-main">
                            <view class="title-row">
                                <h6 class="schedule-title">{{ item.alias || item.service?.title || item.service?.service_name || '未知服务' }}</h6>
                            </view>
                            <view class="notes-row" v-if="item.service?.original_notes || item.private_notes">
                                <text class="note-text">{{ item.private_notes || item.service?.original_notes }}</text>
                            </view>
                        </view>
                        <view class="price-box">
                            <view class="price-top">
                                <text class="price-formula">{{ getPriceFormula(item) }}</text>
                            </view>
                            <view class="price-bottom">
                                <text class="final-amount">¥{{ computeFinalPrice(item) }}</text>
                            </view>
                        </view>
                    </view>
                    
                    <view class="card-actions">
                        <button class="btn btn-sm btn-outline-primary action-btn" @click="openEdit(item.id)">
                            编辑
                        </button>
                        <button class="btn btn-sm btn-outline-danger action-btn delete-btn" @click="remove(item.id)">
                            删除
                        </button>
                        <!-- <button class="btn btn-sm btn-outline-secondary action-btn" @click="openReparent(item)">
                            换源
                        </button> -->
                        <button class="btn btn-sm btn-outline-primary action-btn" @click="createAgentLink(item.id)">
                            推广
                        </button>
                        <button class="btn btn-sm btn-primary action-btn book-btn" @click="book(item.id)">
                            预约
                        </button>
                    </view>
                </view>
            </view>
        </view>
    </view>

    <!-- Import Dialog -->
    <view v-if="showImport" class="share-modal-mask">
        <view class="share-modal-content" @click.stop>
            <view class="modal-header">
                <text class="modal-title">导入服务</text>
                <text class="close-btn" @click="showImport = false">×</text>
            </view>
            <view class="modal-body">
                <input class="form-control mb-3" v-model="importLink" placeholder="粘贴分享链接..." />
                <button class="btn btn-primary w-100 mb-3" @click="handleImport">确认导入</button>
                <view class="divider-text mb-3">或</view>
                <button class="btn btn-outline-primary w-100" @click="scanImport">扫码导入</button>
                
                <view class="mt-4" v-if="importType === 'REPARENT'">
                   <text class="text-danger small">⚠️ 警告：更换上游将改变您的进货价，并可能影响您所有下游代理的价格。</text>
                </view>
            </view>
        </view>
    </view>

    <!-- Share Modal (QR Code) -->
    <ShareModal 
        :visible="showShareModal" 
        :share-link="currentShareLink" 
        @update:visible="showShareModal = $event" 
    />

    <!-- Bottom Tab Bar -->
    <view class="bottom-tab" v-if="userStore.userInfo">
        <view class="tab-item" @click="goToHome">
            <text class="tab-icon">🛠️</text>
            <text>我的服务</text>
        </view>
        <view class="tab-item active">
            <text class="tab-icon">⭐</text>
            <text>收藏</text>
        </view>
        <view class="tab-item" @click="goToPersonal">
            <text class="tab-icon">👤</text>
            <text>个人中心</text>
        </view>
    </view>

    <!-- Batch Import Modal -->
    <view v-if="showBatchImport" class="share-modal-mask">
        <view class="share-modal-content" @click.stop>
            <view class="modal-header">
                <text class="modal-title">批量导入 ({{ importBatchList.length }})</text>
                <text class="close-btn" @click="showBatchImport = false">×</text>
            </view>
            <view class="modal-body" style="max-height: 60vh; overflow-y: auto;">
                <view class="mb-3">
                   <text class="form-label">统一加价设置</text>
                   <view class="input-wrapper">
                      <input class="form-control" type="number" v-model="importForm.markup_value" placeholder="0" />
                      <text class="input-unit">{{ importForm.markup_type === 'PERCENT' ? '%' : '元' }}</text>
                      <view class="type-toggle">
                        <button class="btn btn-sm type-btn" :class="importForm.markup_type==='FIXED' ? 'btn-primary' : 'btn-outline-secondary'" @click="setImportType('FIXED')">固定金额</button>
                        <button class="btn btn-sm type-btn" :class="importForm.markup_type==='PERCENT' ? 'btn-primary' : 'btn-outline-secondary'" @click="setImportType('PERCENT')">百分比</button>
                      </view>
                   </view>
                </view>
                
                <view class="divider-text mb-2">包含以下服务</view>
                
                <view class="batch-list">
                    <view class="batch-item" v-for="item in importBatchList" :key="item.listing_id">
                        <text class="item-title">{{ item.title }}</text>
                        <text class="item-price">¥{{ item.base_price ?? item.price }}</text>
                    </view>
                </view>

                <button class="btn btn-primary w-100 mt-3" @click="confirmBatchImport">确认全部导入</button>
            </view>
        </view>
    </view>

    <!-- Import Edit Modal -->
    <view v-if="showImportEdit" class="share-modal-mask">
        <view class="share-modal-content edit-modal-content" @click.stop>
            <view class="modal-header">
                <text class="modal-title">编辑收藏</text>
                <text class="close-btn" @click="showImportEdit = false">×</text>
            </view>
            <scroll-view scroll-y class="edit-modal-scroll">
                <view class="edit-modal-body">
                    <view class="mb-3">
                        <text class="form-label">服务名称</text>
                        <input class="form-control readonly" :value="importPreview?.title || ''" disabled />
                    </view>
                    <view class="mb-3">
                        <text class="form-label">别名</text>
                        <input class="form-control" v-model="importForm.alias" placeholder="可选" />
                    </view>
                    <view class="form-row-2">
                        <view class="mb-3">
                            <text class="form-label">进货价格</text>
                            <input class="form-control readonly" :value="importPreview?.base_price || 0" disabled />
                            <text class="small text-muted" v-if="importPreview?.parentNodeId">(含上游加价)</text>
                        </view>
                        <view class="mb-3">
                            <text class="form-label">保证金</text>
                            <input class="form-control readonly" :value="importPreview?.deposit_points ?? 0" disabled />
                        </view>
                    </view>
                    <view class="mb-3">
                        <view class="inline-field">
                          <text class="form-label inline-label">加价</text>
                          <view class="markup-inline">
                            <input class="form-control" type="number" v-model="importForm.markup_value" placeholder="0" />
                            <text class="input-unit">{{ importForm.markup_type === 'PERCENT' ? '%' : '元' }}</text>
                            <view class="type-toggle">
                              <button class="btn btn-sm type-btn" :class="importForm.markup_type==='FIXED' ? 'btn-primary' : 'btn-outline-secondary'" @click="setImportType('FIXED')">固定金额</button>
                              <button class="btn btn-sm type-btn" :class="importForm.markup_type==='PERCENT' ? 'btn-primary' : 'btn-outline-secondary'" @click="setImportType('PERCENT')">百分比</button>
                            </view>
                          </view>
                        </view>
                    </view>
                    <view class="mb-3">
                        <text class="form-label">说明</text>
                        <input class="form-control" v-model="importForm.instructions" placeholder="如渠道/适用人群等" />
                    </view>
                    <view class="mb-3">
                        <text class="form-label">备注 (仅自己可见)</text>
                        <input class="form-control" v-model="importForm.private_notes" placeholder="可选" />
                    </view>
                    <view class="mb-3" v-if="importPreview">
                        <text class="text-muted">导入后售价: ¥{{ previewImportPrice }}</text>
                    </view>
                </view>
            </scroll-view>
            <view class="modal-footer">
                <button class="btn btn-primary w-100" @click="confirmImport">确认导入</button>
            </view>
        </view>
    </view>
    
    <!-- Collection Edit Modal -->
    <view v-if="showEdit" class="share-modal-mask">
        <view class="share-modal-content edit-modal-content" @click.stop>
            <view class="modal-header">
                <text class="modal-title">编辑收藏</text>
                <text class="close-btn" @click="showEdit = false">×</text>
            </view>
            <scroll-view scroll-y class="edit-modal-scroll">
                <view class="edit-modal-body">
                    <view class="mb-3">
                        <text class="form-label">服务名称</text>
                        <input class="form-control readonly" :value="editPreview?.service?.title || ''" disabled />
                    </view>
                    <view class="mb-3">
                        <text class="form-label">别名</text>
                        <input class="form-control" v-model="editForm.alias" placeholder="可选" />
                    </view>
                    <view class="form-row-2">
                        <view class="mb-3">
                            <text class="form-label">进货价格</text>
                            <input class="form-control readonly" :value="editPreview?.service?.base_price || 0" disabled />
                            <text class="small text-muted" v-if="editPreview?.parent_node_id">(含上游加价)</text>
                        </view>
                        <view class="mb-3">
                            <text class="form-label">保证金</text>
                            <input class="form-control readonly" :value="editPreview?.service?.deposit_points ?? 0" disabled />
                        </view>
                    </view>
                    <view class="mb-3">
                        <view class="inline-field">
                          <text class="form-label inline-label">加价</text>
                          <view class="markup-inline">
                            <input class="form-control" type="number" v-model="editForm.markup_value" />
                            <text class="input-unit">{{ editForm.markup_type === 'PERCENT' ? '%' : '元' }}</text>
                            <view class="type-toggle">
                              <button class="btn btn-sm type-btn" :class="editForm.markup_type==='FIXED' ? 'btn-primary' : 'btn-outline-secondary'" @click="setEditType('FIXED')">固定金额</button>
                              <button class="btn btn-sm type-btn" :class="editForm.markup_type==='PERCENT' ? 'btn-primary' : 'btn-outline-secondary'" @click="setEditType('PERCENT')">百分比</button>
                            </view>
                          </view>
                        </view>
                    </view>
                    <view class="mb-3">
                        <text class="form-label">说明</text>
                        <input class="form-control" v-model="editForm.instructions" placeholder="如渠道/适用人群等" />
                    </view>
                    <view class="mb-3">
                        <text class="form-label">备注 (仅自己可见)</text>
                        <input class="form-control" v-model="editForm.private_notes" placeholder="可选" />
                    </view>
                    <view class="mb-3" v-if="editPreview">
                        <text class="text-muted">当前售价: ¥{{ previewEditPrice }}</text>
                    </view>
                </view>
            </scroll-view>
            <view class="modal-footer">
                <button class="btn btn-primary w-100" @click="confirmEdit">保存</button>
            </view>
        </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/stores/user';
import { request } from '@/utils/request';
import { onShow } from '@dcloudio/uni-app';
import ShareModal from '@/components/ShareModal.vue';

const userStore = useUserStore();
const list = ref<any[]>([]);
const keyword = ref('');
const showFilter = ref(false);
const filterPrice = ref({ min: '', max: '' });
const filterDate = ref({
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
});
const showImport = ref(false);
const importType = ref<'NEW' | 'REPARENT'>('NEW');
const reparentTargetId = ref('');
const importLink = ref('');
const showImportEdit = ref(false);
const importPreview = ref<any>(null);
const importForm = ref<any>({
    alias: '',
    markup_type: 'FIXED',
    markup_value: 0,
    private_notes: '',
    instructions: '',
});
const showEdit = ref(false);
const editPreview = ref<any>(null);
const editForm = ref<any>({
    alias: '',
    markup_type: 'FIXED',
    markup_value: 0,
    private_notes: '',
    instructions: '',
});
const showShareModal = ref(false);
const currentShareLink = ref('');

const onStartDateChange = (e: any) => {
    filterDate.value.start_date = e.detail.value;
};

const onEndDateChange = (e: any) => {
    filterDate.value.end_date = e.detail.value;
};

const onStartTimeChange = (e: any) => {
    filterDate.value.start_time = e.detail.value;
};

const onEndTimeChange = (e: any) => {
    filterDate.value.end_time = e.detail.value;
};

const resetFilter = () => {
    filterPrice.value = { min: '', max: '' };
    filterDate.value = {
        start_date: '',
        start_time: '',
        end_date: '',
        end_time: '',
    };
};

const filteredList = computed(() => {
    let res = list.value;
    
    // Keyword Filter
    if (keyword.value) {
        const k = keyword.value.toLowerCase();
        res = res.filter(item => {
            const aliasMatch = item.alias?.toLowerCase().includes(k);
            const titleMatch = item.service?.title?.toLowerCase().includes(k);
            const notesMatch = item.private_notes?.toLowerCase().includes(k);
            const originalNotesMatch = item.service?.original_notes?.toLowerCase().includes(k);
            const providerMatch = getProviderName(item).toLowerCase().includes(k);
            return aliasMatch || titleMatch || notesMatch || originalNotesMatch || providerMatch;
        });
    }

    // Price Filter
    if (filterPrice.value.min) {
        res = res.filter(item => Number(computeFinalPrice(item)) >= Number(filterPrice.value.min));
    }
    if (filterPrice.value.max) {
        res = res.filter(item => Number(computeFinalPrice(item)) <= Number(filterPrice.value.max));
    }

    if (filterDate.value.start_date) {
        const startTime = filterDate.value.start_time || '00:00';
        const start = new Date(`${filterDate.value.start_date}T${startTime}:00`).getTime();
        res = res.filter(item => new Date(item.created_at).getTime() >= start);
    }
    if (filterDate.value.end_date) {
        const endTime = filterDate.value.end_time || '23:59';
        const endInclusive = new Date(`${filterDate.value.end_date}T${endTime}:00`).getTime();
        const endExclusive = endInclusive + 60 * 1000;
        res = res.filter(item => new Date(item.created_at).getTime() < endExclusive);
    }

    return res;
});

const getProviderName = (item: any) => {
    return item.service?.owner?.username 
        || item.service?.owner_name
        || item.owner?.username
        || item.service?.resource?.owner?.username
        || '服务提供者';
};

const getPriceFormula = (item: any) => {
    const base = Number(item.service?.base_price) || 0;
    const type = item.markup_type || 'FIXED';
    const val = Number(item.markup_value ?? item.markup_amount ?? 0) || 0;
    
    if (val === 0) return `¥${base}`;
    
    if (type === 'PERCENT') {
        return `¥${base} + ${val}%`;
    }
    return `¥${base} + ¥${val}`;
};

const computeFinalPrice = (item: any) => {
    // Now backend provides pre-calculated cached total price.
    // We prefer cache_total_price for accuracy.
    if (item.cache_total_price !== undefined) {
        return Number(item.cache_total_price).toFixed(2);
    }
    // Fallback logic for old data (if any) or robustness
    const base = Number(item.service?.base_price) || 0;
    const markup = Number(item.markup_amount) || 0;
    return (base + markup).toFixed(2);
};

const previewImportPrice = computed(() => {
    if (!importPreview.value) return 0;
    const base = Number(importPreview.value.base_price) || Number(importPreview.value.price) || 0;
    const val = Number(importForm.value.markup_value) || 0;
    return importForm.value.markup_type === 'PERCENT'
        ? (base * (1 + val / 100)).toFixed(2)
        : (base + val).toFixed(2);
});

const previewEditPrice = computed(() => {
    if (!editPreview.value) return 0;
    const base = Number(editPreview.value.service?.base_price) || 0;
    const val = Number(editForm.value.markup_value) || 0;
    return editForm.value.markup_type === 'PERCENT'
        ? (base * (1 + val / 100)).toFixed(2)
        : (base + val).toFixed(2);
});
const setImportType = (t: 'FIXED' | 'PERCENT') => {
    importForm.value.markup_type = t;
};
const setEditType = (t: 'FIXED' | 'PERCENT') => {
    editForm.value.markup_type = t;
};
const goBack = () => uni.reLaunch({ url: '/pages/index/index' });
const goToHome = () => uni.reLaunch({ url: '/pages/index/index' });
const goToPersonal = () => uni.reLaunch({ url: '/pages/user/profile' });

const loadData = async () => {
  try {
    uni.showLoading({ title: '加载中...' });
    const res: any = await request({ url: '/agency/collection', method: 'GET' });
    list.value = res || [];
  } catch (e) {
    console.error(e);
    uni.showToast({ title: '加载失败', icon: 'none' });
  } finally {
    uni.hideLoading();
  }
};

onShow(() => {
    loadData();
});

const onSearch = () => {
    // Triggered by input/confirm, reactive via computed
};

const showBatchImport = ref(false);
const importBatchList = ref<any[]>([]);

const openReparent = (item: any) => {
    importType.value = 'REPARENT';
    reparentTargetId.value = item.id;
    importLink.value = '';
    showImport.value = true;
};

const handleImport = async () => {
    if (!importLink.value) return uni.showToast({ title: '请输入链接', icon: 'none' });
    
    // Try to match Token (One-time/Direct)
    const tokenMatch = importLink.value.match(/token=([a-zA-Z0-9_-]+)/);
    // Try to match Slug (Agency/Fixed)
    const slugMatch = importLink.value.match(/slug=([a-zA-Z0-9_-]+)/);

    let parentNodeId = '';
    let serviceId = '';

    try {
        uni.showLoading({ title: '解析链接...' });

        if (slugMatch) {
            const slug = slugMatch[1];
            const res: any = await request({ url: `/agent/s/${slug}` });
            if (res && res.importInfo) {
                parentNodeId = res.importInfo.parentNodeId;
                serviceId = res.importInfo.serviceId;
            }
        } else if (tokenMatch) {
            const token = tokenMatch[1];
            // Try AgentLink
            try {
                const resolveRes: any = await request({ url: `/agent/links/${token}` });
                if (resolveRes && resolveRes.schedule) {
                    // AgentLink usually has parent_link_id but not necessarily a parent AGENCY NODE unless resolved
                    // However, AgentLink IS a way to parent to the link creator.
                    // But we need a NODE ID for agency tree.
                    // Does AgentLink resolve to a node?
                    // Currently AgentLink points to (Agent, Schedule).
                    // We need to find the AgencyNode for that Agent+Schedule to parent to it.
                    // Or if it's the owner, parentNodeId is null (which is root).
                    
                    // Actually, our backend resolveLink returns `parentNodeId` if applicable.
                    parentNodeId = resolveRes.parentNodeId; 
                    serviceId = resolveRes.schedule.id;
                }
            } catch (e) {
                 // Try ShareLink
                 const shareRes: any = await request({ url: `/share-link/resolve?token=${token}` });
                 if (shareRes && shareRes.valid && shareRes.type === 'SINGLE') {
                     serviceId = shareRes.data.id;
                     // ShareLink from owner has no parentNodeId
                 }
            }
        }
        
        uni.hideLoading();

        if (!serviceId) {
             uni.showToast({ title: '无效的链接', icon: 'none' });
             return;
        }

        if (importType.value === 'REPARENT') {
             // Execute Reparent
             try {
                 await request({
                     url: `/agency/collection/${reparentTargetId.value}/reparent`,
                     method: 'PATCH',
                     data: { newParentNodeId: parentNodeId } // If null, it means reparent to root (Owner)
                 });
                 uni.showToast({ title: '换源成功', icon: 'success' });
                 showImport.value = false;
                 loadData();
             } catch (e: any) {
                 const msg = e?.message || e?.data?.message || '操作失败';
                 uni.showToast({ title: msg, icon: 'none' });
             }
             return;
        }

        // ... Normal Import Logic ...
        
        if (slugMatch) {
             // ... (Existing Slug Logic)
             const res: any = await request({ url: `/agent/s/${slugMatch[1]}` });
            if (res && res.importInfo) {
                importPreview.value = {
                    ...res.schedule,
                    base_price: res.importInfo.costPrice,
                    parentNodeId: res.importInfo.parentNodeId,
                    serviceId: res.importInfo.serviceId
                };
                importForm.value = { 
                    alias: res.schedule.title || '',
                    markup_type: 'FIXED', 
                    markup_value: 0, 
                    private_notes: '', 
                    instructions: '',
                    parentNodeId: res.importInfo.parentNodeId,
                    serviceId: res.importInfo.serviceId
                };
                showImport.value = false;
                showImportEdit.value = true;
             }
             return;
        }
        
        if (tokenMatch) {
            // ... (Existing Token Logic)
             const token = tokenMatch[1];
             try {
                const resolveRes: any = await request({ url: `/agent/links/${token}` });
                if (resolveRes && resolveRes.schedule) {
                    importPreview.value = {
                        ...resolveRes.schedule,
                        parentNodeId: resolveRes.parentNodeId,
                        serviceId: resolveRes.schedule.id
                    };
                    importForm.value = { 
                        alias: resolveRes.schedule.title || '',
                        markup_type: 'FIXED', 
                        markup_value: 0, 
                        private_notes: '', 
                        instructions: '',
                        parentNodeId: resolveRes.parentNodeId,
                        serviceId: resolveRes.schedule.id
                    };
                    showImport.value = false;
                    showImportEdit.value = true;
                }
             } catch(e) {
                 // ShareLink fallback...
                 try {
                     const shareRes: any = await request({ url: `/share-link/resolve?token=${token}` });
                     if (shareRes && shareRes.valid && shareRes.type === 'SINGLE') {
                        importPreview.value = shareRes.data;
                        importForm.value = { alias: '', markup_type: 'FIXED', markup_value: 0, private_notes: '', instructions: '' };
                        showImport.value = false;
                        showImportEdit.value = true;
                     } else if (shareRes && shareRes.valid && shareRes.type === 'BATCH') {
                        importBatchList.value = shareRes.data;
                        importForm.value = { alias: '', markup_type: 'FIXED', markup_value: 0, private_notes: '', instructions: '' };
                        showImport.value = false;
                        showBatchImport.value = true;
                     }
                 } catch (e2) {}
             }
        }

    } catch (e) {
        uni.hideLoading();
        console.error(e);
        uni.showToast({ title: '链接解析失败', icon: 'none' });
    }
};

const confirmBatchImport = async () => {
    if (!importBatchList.value.length) return;
    try {
        const val = Number(importForm.value.markup_value) || 0;
        
        uni.showLoading({ title: '批量导入中...' });
        
        let successCount = 0;
        for (const item of importBatchList.value) {
            try {
                await request({
                    url: '/agency/collection',
                    method: 'POST',
                    data: { 
                        listingId: item.listing_id,
                        markup_type: importForm.value.markup_type,
                        markup_value: val
                    }
                });
                successCount++;
            } catch (e) {
                console.error(`Failed to import ${item.listing_id}`, e);
            }
        }
        
        uni.hideLoading();
        uni.showToast({ title: `成功导入 ${successCount} 个服务`, icon: 'success' });
        showBatchImport.value = false;
        importBatchList.value = [];
        loadData();
        
    } catch (e) {
        uni.hideLoading();
        console.error(e);
        uni.showToast({ title: '部分导入失败', icon: 'none' });
    }
};

const confirmImport = async () => {
    if (!importPreview.value) return;
    try {
        const combinedNotes = [
            importForm.value.instructions ? `说明：${importForm.value.instructions}` : '',
            importForm.value.private_notes ? `备注：${importForm.value.private_notes}` : ''
        ].filter(Boolean).join('\n');
        
        // Base is the cost price for this agent
    const base = Number(importPreview.value.base_price) || 0;
    const val = Number(importForm.value.markup_value) || 0;
    const calcAmount = importForm.value.markup_type === 'PERCENT' ? Math.round(base * (val/100)) : val;
    
    const payload: any = { 
            markup_amount: calcAmount,
            markup_type: importForm.value.markup_type, // Persist markup type
            markup_value: val, // Persist raw markup value
            alias: importForm.value.alias,
            private_notes: combinedNotes 
        };

        console.log('Confirm Import - Form State:', importForm.value);
        if (importForm.value.parentNodeId) {
            // Recursive import
            payload.serviceId = importForm.value.serviceId;
            payload.parentNodeId = importForm.value.parentNodeId;
            console.log('Recursive Import - Parent Node ID:', payload.parentNodeId);
        } else {
            // Direct listing import or Share Link import (without parentNodeId)
            console.log('Direct Import - No Parent Node ID');
            if (importPreview.value.listing_id) {
                payload.listingId = importPreview.value.listing_id;
            } else if (importPreview.value.id) {
                // Direct Service Import (e.g. from ShareLink)
                payload.serviceId = importPreview.value.id;
            }
        }
        
        // Safety check
        if (!payload.listingId && !payload.serviceId) {
             uni.showToast({ title: '无效的服务ID', icon: 'none' });
             return;
        }

        console.log('Sending Import Payload:', payload);
        await request({
            url: '/agency/collection',
            method: 'POST',
            data: payload
        });
        uni.showToast({ title: '导入成功', icon: 'success' });
        showImportEdit.value = false;
        importLink.value = '';
        importPreview.value = null;
        loadData();
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '导入失败', icon: 'none' });
    }
};

const scanImport = () => {
    uni.scanCode({
        success: (res) => {
            importLink.value = res.result;
            handleImport();
        }
    });
};

const remove = (id: string) => {
    uni.showModal({
        title: '移除收藏',
        content: '确定要从收藏列表中移除吗？',
        success: async (res) => {
            if (res.confirm) {
                try {
                    await request({ url: `/agency/collection/${id}`, method: 'DELETE' });
                    list.value = list.value.filter(item => item.id !== id);
                    uni.showToast({ title: '已移除', icon: 'none' });
                } catch(e) {
                    console.error(e);
                    uni.showToast({ title: '操作失败', icon: 'none' });
                }
            }
        }
    });
};

const createAgentLink = async (id: string) => {
  const item = list.value.find(i => i.id === id);
  if (item && item.share_slug) {
      const path = `/pages/booking/detail?slug=${item.share_slug}`;
      let fullUrl = path;
      // #ifdef H5
      fullUrl = window.location.origin + '/#' + path;
      // #endif
      
      currentShareLink.value = fullUrl;
      showShareModal.value = true;
      return;
  } else if (item) {
      // For collection items, we should only use share_slug.
      // If missing, it means data is inconsistent.
      uni.showToast({ title: '该项暂未分配分享短链，请重新收藏', icon: 'none' });
      console.error('Missing share_slug for collection item:', item);
  }
};

const book = (id: string) => {
    const item = list.value.find(i => i.id === id);
    if (item) {
        if (item.service_id) {
            // Collection Item
            uni.navigateTo({ url: `/pages/booking/detail?agency_node_id=${item.id}` });
        } else {
            // Direct Schedule
            uni.navigateTo({ url: `/pages/booking/detail?schedule_id=${item.id}` });
        }
    }
};

const openEdit = (id: string) => {
    const item = list.value.find(i => i.id === id);
    if (!item) return;
    editPreview.value = item;
    
    // Parse existing notes to separate instructions and private_notes
    // Format: "说明：xxx\n备注：yyy"
    let instructions = '';
    let privateNotes = '';
    
    if (item.private_notes) {
        const parts = item.private_notes.split('\n');
        for (const part of parts) {
            if (part.startsWith('说明：')) {
                instructions = part.replace('说明：', '');
            } else if (part.startsWith('备注：')) {
                privateNotes = part.replace('备注：', '');
            } else {
                // If it doesn't have a prefix, assume it's part of the last field or just plain text
                // But to avoid adding prefixes when there were none, we should check logic.
                // However, the confirmEdit function WILL add prefixes.
                // So if we have legacy data without prefixes, we should decide where it goes.
                // Let's assume legacy data is 'privateNotes'.
                if (privateNotes) privateNotes += '\n' + part;
                else privateNotes = part;
            }
        }
    }

    editForm.value = {
        alias: item.alias || '',
        markup_type: item.markup_type || 'FIXED',
        markup_value: item.markup_value ?? item.markup_amount ?? 0,
        private_notes: privateNotes,
        instructions: instructions
    };
    showEdit.value = true;
};

const confirmEdit = async () => {
    if (!editPreview.value) return;
    const base = Number(editPreview.value.service?.base_price) || 0;
    const val = Number(editForm.value.markup_value) || 0;
    const calcAmount = editForm.value.markup_type === 'PERCENT' ? Math.round(base * (val/100)) : val;
    const combinedNotes = [
        editForm.value.instructions ? `说明：${editForm.value.instructions}` : '',
        editForm.value.private_notes ? `备注：${editForm.value.private_notes}` : ''
    ].filter(Boolean).join('\n');
    const payload = { 
        markup_amount: calcAmount, 
        markup_type: editForm.value.markup_type,
        markup_value: val,
        alias: editForm.value.alias,
        private_notes: combinedNotes 
    };
    try {
        const res: any = await request({ url: `/agency/collection/${editPreview.value.id}`, method: 'PATCH', data: payload });
        
        // Update list with response data
        const idx = list.value.findIndex(i => i.id === editPreview.value!.id);
        if (idx > -1 && res) {
            // Preserve original service to maintain consistent base_price display
            // (Even though backend is fixed to return calculated price, this adds robustness)
            const originalService = list.value[idx].service;
            
            // Merge response into list item to ensure UI reflects backend state
            list.value[idx] = { ...list.value[idx], ...res };
            
            // Restore service object
            if (originalService) {
                list.value[idx].service = originalService;
            }

            // Specifically update critical price fields from response
            list.value[idx].markup_type = res.markup_type;
            list.value[idx].markup_value = Number(res.markup_value);
            list.value[idx].markup_amount = Number(res.markup_amount);
            list.value[idx].private_notes = res.private_notes;
        }
        
        uni.showToast({ title: '已保存', icon: 'success' });
        showEdit.value = false;
        editPreview.value = null;
    } catch (e) {
        console.error(e);
        uni.showToast({ title: '保存失败', icon: 'none' });
    }
};

onMounted(() => {
  loadData();
});
</script>

<style>
/* Reusing global styles from App.vue */
.filter-bar {
    display: block;
}
.table-header {
    display: flex;
    justify-content: flex-end;
    width: 100%;
}
.header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
.search-actions { 
    display: flex; 
    align-items: center; 
    gap: 12px; 
    width: 100%; 
    flex-wrap: nowrap;
    justify-content: flex-end;
}
.search-input-wrap {
    flex: 1;
    min-width: 0;
    height: 44px;
    display: flex;
    align-items: center;
    background-color: #fff;
    border-radius: 22px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    overflow: hidden;
    padding-left: 20px;
    padding-right: 12px;
}
.search-actions .search-input { display: block; width: 100%; }
.search-actions .import-btn { flex: 0 0 auto; }
.search-input {
    flex: 1;
    width: auto;
    background-color: transparent;
    border: none;
    height: 100%;
    padding: 0;
    font-size: 14px;
}
.search-input.form-control {
    height: 100%;
    line-height: normal;
    padding: 0;
    margin: 0;
    border: 0;
    box-shadow: none;
    background: transparent;
}
.search-input .uni-input-wrapper {
    height: 100%;
    display: flex;
    align-items: center;
    overflow: hidden;
    border-radius: 22px;
}
.search-input .uni-input-form {
    flex: 1;
    min-width: 0;
}
.search-input .uni-input-input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: none;
    outline: none;
    background-color: transparent;
    padding: 0;
    margin: 0;
}
.search-input .uni-input-input:focus {
    outline: none;
}
.filter-icon-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 22px;
    color: #475569;
}
.import-btn {
    height: 44px;
    padding: 0 20px;
    background-color: #4e97fc;
    border-radius: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(78, 151, 252, 0.3);
    margin-left: 0; /* Reset margin */
    white-space: nowrap;
}
.import-text {
    color: #fff;
    font-size: 14px;
    font-weight: 600;
}
.import-btn:active {
    background-color: #3b82f6;
    transform: scale(0.95);
}
.filter-panel {
    background-color: #fff;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
.filter-row {
    margin-bottom: 12px;
}
.filter-label {
    font-size: 13px;
    font-weight: 600;
    color: #475569;
    margin-bottom: 8px;
    display: block;
}
.filter-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
}
.datetime-cell {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
}
.datetime-grid {
    display: flex;
    align-items: stretch;
    gap: 10px;
}
.datetime-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.datetime-sep {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    width: 18px;
}
.datetime-picker {
    flex: 1;
    min-width: 0;
}
.filter-input, .picker-input {
    flex: 1;
    height: 36px;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 0 12px;
    font-size: 14px;
    color: #334155;
    display: flex;
    align-items: center;
}
.picker-input {
    justify-content: flex-start;
}
.picker-placeholder {
    color: #94a3b8;
}
.separator {
    color: #cbd5e1;
    font-weight: bold;
}
.share-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.share-modal-content {
  width: 88%;
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
  padding-bottom: 12px;
  display: flex;
  flex-direction: column;
  max-height: calc(var(--app-vh, 1vh) * 85);
}
.edit-modal-content {
  width: 92%;
  height: calc(var(--app-vh, 1vh) * 92);
  max-height: calc(var(--app-vh, 1vh) * 92);
  padding-bottom: 0;
}
.modal-header {
  padding: 10px 12px;
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
  font-size: 24px;
  color: #94a3b8;
  line-height: 1;
}
.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow-y: auto;
}
.edit-modal-scroll {
  flex: 1 1 auto;
  min-height: 0;
}
.edit-modal-body {
  padding: 12px;
  box-sizing: border-box;
}
.modal-footer {
  padding: 10px 12px;
  border-top: 1px solid #f1f5f9;
  background-color: #fff;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.modal-footer .btn {
  margin: 0;
}
.input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}
.type-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  white-space: nowrap;
}
.type-btn {
  height: 34px;
  line-height: 34px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.markup-inline .form-control,
.input-wrapper .form-control {
  display: flex;
  align-items: center;
}
.markup-inline .form-control .uni-input-wrapper,
.input-wrapper .form-control .uni-input-wrapper {
  display: flex;
  align-items: center;
  height: 100%;
  width: 100%;
}
.markup-inline .form-control .uni-input-input,
.input-wrapper .form-control .uni-input-input {
  height: 100%;
  line-height: 34px;
  padding-top: 0;
  padding-bottom: 0;
  margin: 0;
  box-sizing: border-box;
}
.input-wrapper .form-control {
  flex: 1;
  min-width: 0;
}
.input-unit {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 14px;
  padding-right: 0;
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-modal-body .mb-3 { margin-bottom: 8px; }
.edit-modal-body .form-label { font-size: 13px; margin-bottom: 6px; }
.edit-modal-body .form-control { height: 34px; padding: 0 12px; font-size: 14px; }
.edit-modal-body .markup-inline .form-control {
  padding: 0 8px;
}
.inline-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.inline-label {
  margin-bottom: 0;
  flex: 0 0 auto;
  width: auto;
  white-space: nowrap;
}
.markup-inline {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-modal-body .markup-inline {
  gap: 6px;
}
.markup-inline {
  height: 34px;
  align-items: stretch;
}
.markup-inline .form-control {
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
}
.markup-inline .input-unit {
  height: 100%;
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 34px;
}
.markup-inline .type-toggle {
  height: 100%;
  align-items: stretch;
}
.markup-inline .type-btn {
  height: 100%;
  font-size: 14px;
}
.radio-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
}
.modal-body .mb-3 { margin-bottom: 10px; }
.modal-body .form-label { font-size: 13px; margin-bottom: 6px; }
.modal-body .form-control { height: 36px; padding: 0 12px; font-size: 14px; }
.share-modal-content .btn { height: 40px; line-height: 40px; }
.type-toggle .type-btn {
  height: 34px;
  line-height: 34px;
}
.markup-inline .input-unit {
  height: 34px;
  display: flex;
  align-items: center;
  line-height: 34px;
}
.form-control.readonly {
  background-color: #f8fafc;
  color: #94a3b8;
}
.divider-text {
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
}
.schedule-card {
    border: 1px solid #e2e8f0;
    box-shadow: none;
    border-radius: 12px;
    margin-bottom: 6px;
}
.card-body.compact { padding: 8px; }
.card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 4px;
    column-gap: 8px;
}
.info-main { min-width: 0; flex: 1; }
.title-row {
    display: flex;
    align-items: center;
    margin-bottom: 2px;
    gap: 8px;
}
.schedule-title {
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 0;
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.source-tag {
    display: inline-block;
    background-color: rgba(78, 151, 252, 0.08);
    color: #4e97fc;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    flex-shrink: 0;
}
.notes-row { margin-top: 2px; }
.note-text {
    font-size: 11px;
    color: #64748b;
    margin-top: 2px;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.price-box {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex: 0 0 auto;
}
.price-top { line-height: 1; }
.price-bottom { line-height: 1; }
.price-formula { font-size: 10px; color: #64748b; font-weight: 500; }
.final-amount { font-size: 18px; font-weight: 800; color: #1e293b; }
.card-actions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    align-items: stretch;
}
.card-actions .btn,
.card-actions .btn-sm {
    margin: 0;
}
.action-btn { min-width: 0; height: 32px; padding: 0 8px; font-size: 12px; }
.book-btn { box-shadow: 0 3px 6px -1px rgba(30,41,59,0.25); }
.note-text {
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.delete-btn {
    border-color: #fee2e2;
    color: #ef4444;
}
.form-row-2 {
    display: flex;
    gap: 12px;
}
.form-row-2 .mb-3 {
    flex: 1;
}
</style>
