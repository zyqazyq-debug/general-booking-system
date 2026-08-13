import { computed, ref, type Ref } from 'vue';
import { updateDistributionLink } from '@/domains/library';

const createEditForm = () => ({
  alias: '',
  markup_type: 'FIXED',
  markup_value: 0,
  private_notes: '',
  instructions: '',
});

const extractLegacyNotes = (raw: string) => {
  let instructions = '';
  let privateNotes = '';

  for (const part of raw.split('\n')) {
    if (part.startsWith('说明：')) {
      instructions = part.replace('说明：', '');
      continue;
    }
    if (part.startsWith('备注：')) {
      privateNotes = part.replace('备注：', '');
      continue;
    }
    privateNotes = privateNotes ? `${privateNotes}\n${part}` : part;
  }

  return { instructions, privateNotes };
};

export function useScheduleCollectionEditor(list: Ref<any[]>) {
  const showEdit = ref(false);
  const editPreview = ref<any>(null);
  const editForm = ref<any>(createEditForm());

  const previewEditPrice = computed(() => {
    if (!editPreview.value) return 0;
    const base = Number(editPreview.value.service?.base_price) || 0;
    const value = Number(editForm.value.markup_value) || 0;
    return editForm.value.markup_type === 'PERCENT'
      ? (base * (1 + value / 100)).toFixed(2)
      : (base + value).toFixed(2);
  });

  const setEditType = (type: 'FIXED' | 'PERCENT') => {
    editForm.value.markup_type = type;
  };

  const openEdit = (id: string) => {
    const item = list.value.find((entry) => entry.id === id);
    if (!item) return;

    editPreview.value = item;
    const legacy = extractLegacyNotes(item.private_notes || '');
    editForm.value = {
      alias: item.alias || '',
      markup_type: item.markup_type || 'FIXED',
      markup_value: item.markup_value ?? item.markup_amount ?? 0,
      private_notes: legacy.privateNotes,
      instructions: legacy.instructions,
    };
    showEdit.value = true;
  };

  const confirmEdit = async () => {
    if (!editPreview.value) return;

    const base = Number(editPreview.value.service?.base_price) || 0;
    const value = Number(editForm.value.markup_value) || 0;
    const markupAmount = editForm.value.markup_type === 'PERCENT' ? Math.round(base * (value / 100)) : value;
    const payload = {
      markup_amount: markupAmount,
      markup_type: editForm.value.markup_type,
      markup_value: value,
      alias: editForm.value.alias,
      private_notes: [
        editForm.value.instructions ? `说明：${editForm.value.instructions}` : '',
        editForm.value.private_notes ? `备注：${editForm.value.private_notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };

    try {
      const response: any = await updateDistributionLink(editPreview.value.id, payload);
      const targetIndex = list.value.findIndex((item) => item.id === editPreview.value.id);
      if (targetIndex > -1 && response) {
        const originalService = list.value[targetIndex].service;
        list.value[targetIndex] = { ...list.value[targetIndex], ...response };
        if (originalService) {
          list.value[targetIndex].service = originalService;
        }
        list.value[targetIndex].markup_type = response.markup_type;
        list.value[targetIndex].markup_value = Number(response.markup_value);
        list.value[targetIndex].markup_amount = Number(response.markup_amount);
        list.value[targetIndex].private_notes = response.private_notes;
        list.value[targetIndex].cache_total_price = base + Number(response.markup_amount || 0);
      }

      uni.showToast({ title: '已保存', icon: 'success' });
      showEdit.value = false;
      editPreview.value = null;
    } catch (error) {
      console.error(error);
      uni.showToast({ title: '保存失败', icon: 'none' });
    }
  };

  return {
    showEdit,
    editPreview,
    editForm,
    previewEditPrice,
    setEditType,
    openEdit,
    confirmEdit,
  };
}
