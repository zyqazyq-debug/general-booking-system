import { type Ref, ref } from 'vue';
import { extractApiErrorCode, resolveApiErrorMessage } from '@/utils/error-code';
import { extractImportCode } from '@/shared/utils/import-link';
import { reparentDistributionLink } from '../api/distribution';
import { resolveLibraryImportTarget } from './libraryImportLinkResolver';
import { runLibraryImportPrecheck } from './libraryImportPrecheck';
import { resolveLibraryImportConflict } from './libraryImportConflict';

interface UseLibraryImportResolverOptions {
  userStore: any;
  loadData: () => Promise<void>;
  showImport: Ref<boolean>;
  importType: Ref<'NEW' | 'REPARENT'>;
  reparentTargetId: Ref<string>;
  importLink: Ref<string>;
  showBatchImport: Ref<boolean>;
  importBatchList: Ref<any[]>;
  editMode: Ref<'CREATE' | 'UPDATE'>;
  showEdit: Ref<boolean>;
  editPreview: Ref<any>;
  editForm: Ref<any>;
}

export function useLibraryImportResolver(options: UseLibraryImportResolverOptions) {
  const isImporting = ref(false);
  const openCreateEditByToken = async (
    token: string,
    resolvedParentNodeId: string,
    importAsChild = false,
  ) => {
    const resolvedTarget = await resolveLibraryImportTarget(token);
    if (!resolvedTarget) {
      return false;
    }

    options.editMode.value = 'CREATE';
    options.editPreview.value = {
      service: resolvedTarget.service,
      parentNodeId: resolvedParentNodeId || resolvedTarget.parentNodeId,
      serviceId: resolvedTarget.serviceId,
      importAsChild,
    };
    options.editForm.value = {
      alias: resolvedTarget.service?.title || '',
      markup_type: 'FIXED',
      markup_value: 0,
      private_notes: '',
      instructions: resolvedTarget.service?.description || '',
      token,
      importAsChild,
    };
    options.showImport.value = false;
    options.showEdit.value = true;
    return true;
  };

  const handleImport = async () => {
    if (!options.importLink.value) return uni.showToast({ title: '请输入链接', icon: 'none' });
    if (isImporting.value) return;

    const token = extractImportCode(options.importLink.value);
    if (!token) {
      return uni.showToast({ title: '无效的链接', icon: 'none' });
    }

    try {
      isImporting.value = true;
      const checkRes = await runLibraryImportPrecheck(token);

      if (options.importType.value === 'REPARENT') {
        if (!checkRes.parent_id) {
          throw new Error('无效的链接，无法获取上游节点');
        }
        uni.showLoading({ title: '换源中...' });
          await reparentDistributionLink(options.reparentTargetId.value, checkRes.parent_id);
          uni.hideLoading();
        uni.showToast({ title: '换源成功', icon: 'success' });
        options.showImport.value = false;
        options.loadData();
        return;
      }

      const { action_type, prompt_msg, parent_id } = checkRes;
      const conflict = await resolveLibraryImportConflict(action_type, prompt_msg);
      if (conflict.blocked) {
        return;
      }

      await openCreateEditByToken(token, parent_id || '', conflict.importAsChild);
    } catch (e: any) {
      uni.hideLoading();
      console.error(e);
      const errorCode = extractApiErrorCode(e);
      const activeCount = Number((e as any)?.active_count ?? (e as any)?.data?.active_count);
      const activeLimit = Number((e as any)?.active_limit ?? (e as any)?.data?.active_limit);
      if (errorCode === 'COLLECTION_ACTIVE_LIMIT_EXCEEDED' && Number.isFinite(activeCount) && Number.isFinite(activeLimit)) {
        uni.showToast({ title: `已达上限(${activeCount}/${activeLimit})，请先扩容或下架`, icon: 'none' });
        return;
      }
      const msg = resolveApiErrorMessage(e, '操作失败').message;
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      isImporting.value = false;
    }
  };

  return {
    handleImport,
  };
}
