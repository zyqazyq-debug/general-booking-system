import { ref, type Ref } from 'vue';
import { useUserStore } from '@/shared/stores/user';
import { useLibraryImportResolver } from './useLibraryImportResolver';
import { useLibraryBatchImport } from './useLibraryBatchImport';

export function useLibraryImport(
  loadData: () => Promise<void>,
  showEdit: Ref<boolean>,
  editMode: Ref<'CREATE' | 'UPDATE'>,
  editPreview: Ref<any>,
  editForm: Ref<any>,
) {
  const userStore = useUserStore();
  const showImport = ref(false);
  const importType = ref<'NEW' | 'REPARENT'>('NEW');
  const reparentTargetId = ref('');
  const importLink = ref('');
  const showBatchImport = ref(false);
  const importBatchList = ref<any[]>([]);

  const openReparent = (item: any) => {
    importType.value = 'REPARENT';
    reparentTargetId.value = item.id;
    importLink.value = '';
    showImport.value = true;
  };

  const scanImport = () => {
    uni.scanCode({
      success: (res) => {
        importLink.value = res.result;
        handleImport();
      },
    });
  };
  const { handleImport } = useLibraryImportResolver({
    userStore,
    loadData,
    showImport,
    importType,
    reparentTargetId,
    importLink,
    showBatchImport,
    importBatchList,
    editMode,
    showEdit,
    editPreview,
    editForm,
  });

  const { confirmBatchImport } = useLibraryBatchImport({
    userStore,
    showBatchImport,
    importBatchList,
    editForm,
    loadData,
  });

  return {
    showImport,
    importType,
    reparentTargetId,
    importLink,
    showBatchImport,
    importBatchList,
    openReparent,
    scanImport,
    handleImport,
    confirmBatchImport,
  };
}
