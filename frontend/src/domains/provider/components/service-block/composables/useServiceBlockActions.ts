import { ref, type Ref } from 'vue';
import { createGlobalServiceBlock, createServiceBlock, deleteGlobalServiceBlock, getGlobalServiceBlocks, updateGlobalServiceBlock } from '@/shared/api/service';
import { showAppConfirm } from '@/utils/app-confirm';
import { resolveApiErrorMessage } from '@/utils/error-code';

interface UseServiceBlockActionsOptions {
  serviceId: Ref<string | undefined>;
  isGlobal: Ref<boolean>;
  form: {
    start_date: string;
    start_clock: string;
    end_date: string;
    end_clock: string;
    reason: string;
    type: any;
  };
  editingGlobalId: Ref<string>;
  globalLoading: Ref<boolean>;
  globalBlocks: Ref<any[]>;
  setRange: (start: Date, end: Date) => void;
  normalizeClockToHalfHour: (clock: string) => string;
  parseDateTimeValue: (dateText: string, timeText: string) => Date | null;
  emitSuccess: () => void;
  close: () => void;
}

export function useServiceBlockActions(options: UseServiceBlockActionsOptions) {
  const loading = ref(false);

  const loadGlobalBlocks = async () => {
    if (!options.isGlobal.value) return;
    options.globalLoading.value = true;
    try {
      const res: any = await getGlobalServiceBlocks();
      options.globalBlocks.value = Array.isArray(res) ? res : [];
    } catch (e) {
      console.error(e);
      const { message: msg } = resolveApiErrorMessage(e, '加载休息记录失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      options.globalLoading.value = false;
    }
  };

  const prepareEditGlobal = (item: any) => {
    options.editingGlobalId.value = item.id;
    const start = new Date(item.start_time);
    const end = new Date(item.end_time);
    options.setRange(start, end);
    options.form.reason = item.reason || '';
  };

  const removeGlobal = async (blockId: string) => {
    const res = await showAppConfirm({
      title: '删除休息段',
      content: '确定删除这条休息日程吗？',
    });
    if (!res.confirm) return;
    try {
      await deleteGlobalServiceBlock(blockId);
      uni.showToast({ title: '已删除', icon: 'success' });
      options.emitSuccess();
      if (options.editingGlobalId.value === blockId) {
        options.editingGlobalId.value = '';
      }
      await loadGlobalBlocks();
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '删除失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const submit = async () => {
    if (!options.form.start_date || !options.form.start_clock || !options.form.end_date || !options.form.end_clock) {
      uni.showToast({ title: '请选择起止时间', icon: 'none' });
      return;
    }

    const normalizedStartClock = options.normalizeClockToHalfHour(options.form.start_clock);
    const normalizedEndClock = options.normalizeClockToHalfHour(options.form.end_clock);
    if (!normalizedStartClock || !normalizedEndClock) {
      uni.showToast({ title: '时间格式不正确', icon: 'none' });
      return;
    }
    if (normalizedStartClock !== options.form.start_clock || normalizedEndClock !== options.form.end_clock) {
      options.form.start_clock = normalizedStartClock;
      options.form.end_clock = normalizedEndClock;
      uni.showToast({ title: '已自动调整为半小时粒度', icon: 'none' });
    }

    const startDate = options.parseDateTimeValue(options.form.start_date, normalizedStartClock);
    const endDate = options.parseDateTimeValue(options.form.end_date, normalizedEndClock);
    if (!startDate || !endDate) {
      uni.showToast({ title: '时间格式不正确', icon: 'none' });
      return;
    }
    if (startDate >= endDate) {
      uni.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' });
      return;
    }

    const res = await showAppConfirm({
      title: options.editingGlobalId.value ? '确认修改休息' : '确认增加休息',
      content: '休息会影响对应时间的预定，但不影响已预定的日程。',
      confirmText: options.editingGlobalId.value ? '确认修改' : '确认增加',
      cancelText: '取消',
    });
    if (!res.confirm) return;

    loading.value = true;
    try {
      const payload = {
        reason: options.form.reason,
        type: options.form.type,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
      };
      if (options.isGlobal.value) {
        if (options.editingGlobalId.value) {
          await updateGlobalServiceBlock(options.editingGlobalId.value, payload);
          uni.showToast({ title: '修改成功', icon: 'success' });
          options.editingGlobalId.value = '';
        } else {
          await createGlobalServiceBlock(payload);
          uni.showToast({ title: '设置成功', icon: 'success' });
        }
        options.emitSuccess();
        await loadGlobalBlocks();
        return;
      }

      if (!options.serviceId.value) throw new Error('Service ID required');
      await createServiceBlock(options.serviceId.value, payload);
      uni.showToast({ title: '设置成功', icon: 'success' });
      options.emitSuccess();
      options.close();
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '设置失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    loadGlobalBlocks,
    prepareEditGlobal,
    removeGlobal,
    submit,
  };
}
