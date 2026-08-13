import { type Ref } from 'vue';
import { createService, updateService, deleteService } from '@/shared/api/service';
import { showAppConfirm } from '@/utils/app-confirm';
import { resolveApiErrorMessage } from '@/utils/error-code';

interface UseServiceEditActionsOptions {
  serviceId: Ref<string | undefined>;
  form: any;
  rules: any;
  policy: any;
  onSaved: () => void;
  onClose: () => void;
}

export function useServiceEditActions(options: UseServiceEditActionsOptions) {
  const submit = async () => {
    try {
      if (!options.form.title) {
        uni.showToast({ title: '请输入标题', icon: 'none' });
        return;
      }

      const payload = {
        ...options.form,
        base_price: Number(options.form.base_price),
        deposit_points: Number(options.form.deposit_points),
        duration_minutes: Number(options.form.duration_minutes),
        buffer_minutes: Number(options.form.buffer_minutes),
        rules: options.rules,
        cancellation_policy: options.policy,
      };

      if (options.serviceId.value) {
        await updateService(options.serviceId.value, payload);
        uni.showToast({ title: '已更新', icon: 'success' });
      } else {
        await createService(payload);
        uni.showToast({ title: '已创建', icon: 'success' });
      }
      options.onSaved();
      options.onClose();
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  const confirmDelete = async () => {
    const res = await showAppConfirm({
      title: '确认删除',
      content: '确定要删除这个服务吗？删除后无法恢复。',
      confirmColor: '#ef4444',
    });
    if (!res.confirm) return;
    try {
      await deleteService(options.serviceId.value as string);
      uni.showToast({ title: '已删除', icon: 'success' });
      options.onSaved();
      options.onClose();
    } catch (e) {
      const { message: msg } = resolveApiErrorMessage(e, '删除失败');
      uni.showToast({ title: msg, icon: 'none' });
    }
  };

  return {
    submit,
    confirmDelete,
  };
}
