import { computed, reactive, ref, type Ref } from 'vue';
import { getServiceDetail } from '@/shared/api/service';
import { resolveApiErrorMessage } from '@/utils/error-code';

interface UseServiceEditStateOptions {
  serviceId: Ref<string | undefined>;
  ownerId: Ref<string | undefined>;
}

export function useServiceEditState(options: UseServiceEditStateOptions) {
  const loading = ref(false);
  const isEdit = computed(() => !!options.serviceId.value);

  const form = reactive({
    title: '',
    base_price: 0,
    deposit_points: 0,
    duration_minutes: 60,
    buffer_minutes: 0,
    is_active: true,
    owner_id: '',
    description: '',
    original_notes: '',
  });

  const rules = reactive({
    start_hour: 9,
    end_hour: 17,
    weekdays: [1, 2, 3, 4, 5] as number[],
  });

  const policy = reactive({
    type: 'custom',
    window_minutes: 120,
    penalty_percent: 0,
  });

  const weekDaysList = [
    { val: 1, label: '一' },
    { val: 2, label: '二' },
    { val: 3, label: '三' },
    { val: 4, label: '四' },
    { val: 5, label: '五' },
    { val: 6, label: '六' },
    { val: 7, label: '日' },
  ];

  const resetForm = () => {
    form.title = '';
    form.base_price = 0;
    form.deposit_points = 0;
    form.duration_minutes = 60;
    form.buffer_minutes = 0;
    form.is_active = true;
    form.owner_id = options.ownerId.value || '';
    form.description = '';
    form.original_notes = '';

    rules.start_hour = 9;
    rules.end_hour = 17;
    rules.weekdays = [1, 2, 3, 4, 5];

    policy.window_minutes = 120;
    policy.penalty_percent = 0;
  };

  const loadData = async () => {
    if (!options.serviceId.value) {
      resetForm();
      loading.value = false;
      return true;
    }

    loading.value = true;
    try {
      const res: any = await getServiceDetail(options.serviceId.value);
      if (res) {
        form.title = res.title;
        form.base_price = res.base_price;
        form.deposit_points = res.deposit_points;
        form.duration_minutes = res.duration_minutes;
        form.buffer_minutes = res.buffer_minutes;
        form.is_active = res.is_active;
        form.owner_id = res.owner_id;
        form.description = res.description || '';
        form.original_notes = res.original_notes || '';

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
      return true;
    } catch (e) {
      console.error(e);
      const { message: msg } = resolveApiErrorMessage(e, '加载失败');
      uni.showToast({ title: msg, icon: 'none' });
      return false;
    } finally {
      loading.value = false;
    }
  };

  const toggleDay = (day: number) => {
    const idx = rules.weekdays.indexOf(day);
    if (idx > -1) {
      rules.weekdays.splice(idx, 1);
      return;
    }
    rules.weekdays.push(day);
    rules.weekdays.sort((a, b) => a - b);
  };

  const onStatusChange = (e: any) => {
    form.is_active = e.detail.value;
  };

  return {
    loading,
    isEdit,
    form,
    rules,
    policy,
    weekDaysList,
    loadData,
    toggleDay,
    onStatusChange,
  };
}
