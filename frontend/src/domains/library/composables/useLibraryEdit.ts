import { type Ref } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { useLibraryEditState } from './useLibraryEditState';
import { useLibraryEditSubmit } from './useLibraryEditSubmit';

export function useLibraryEdit(
  list: Ref<any[]>,
  loadData: () => Promise<void>,
  importLink: Ref<string>,
) {
  const userStore = useUserStore();
  const { showEdit, editMode, editPreview, editForm, setEditType, openEdit } = useLibraryEditState(list);
  const { confirmEdit, confirmSaveAsCopy } = useLibraryEditSubmit({
    userStore,
    list,
    loadData,
    importLink,
    showEdit,
    editMode,
    editPreview,
    editForm,
  });

  return {
    showEdit,
    editMode,
    editPreview,
    editForm,
    setEditType,
    openEdit,
    confirmEdit,
    confirmSaveAsCopy,
  };
}
