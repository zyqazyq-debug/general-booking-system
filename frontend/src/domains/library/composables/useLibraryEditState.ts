import { ref, type Ref } from 'vue';

export function useLibraryEditState(list: Ref<any[]>) {
  const showEdit = ref(false);
  const editMode = ref<'CREATE' | 'UPDATE'>('UPDATE');
  const editPreview = ref<any>(null);
  const editForm = ref<any>({
    alias: '',
    markup_type: 'FIXED',
    markup_value: 0,
    private_notes: '',
    instructions: '',
  });

  const setEditType = (t: 'FIXED' | 'PERCENT') => {
    editForm.value.markup_type = t;
  };

  const extractLegacyNotes = (raw: string) => {
    let instructions = '';
    let privateNotes = '';
    const parts = raw.split('\n');
    for (const part of parts) {
      if (part.startsWith('说明：')) instructions = part.replace('说明：', '');
      else if (part.startsWith('备注：')) privateNotes = part.replace('备注：', '');
      else privateNotes = privateNotes ? `${privateNotes}\n${part}` : part;
    }
    return { instructions, privateNotes };
  };

  const openEdit = (id: string) => {
    const item = list.value.find((i) => i.id === id);
    if (!item) return;
    editMode.value = 'UPDATE';
    editPreview.value = item;

    let instructions = item.public_notes || '';
    let privateNotes = item.private_notes || '';
    if (!item.public_notes && item.private_notes) {
      const legacy = extractLegacyNotes(item.private_notes);
      instructions = legacy.instructions;
      privateNotes = legacy.privateNotes;
    }

    editForm.value = {
      alias: item.alias || '',
      markup_type: item.markup_type || 'FIXED',
      markup_value: item.markup_value ?? item.markup_amount ?? 0,
      private_notes: privateNotes,
      instructions,
    };
    showEdit.value = true;
  };

  return {
    showEdit,
    editMode,
    editPreview,
    editForm,
    setEditType,
    openEdit,
  };
}
