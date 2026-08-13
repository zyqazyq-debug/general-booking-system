import { type Ref } from 'vue';
import { createDistributionLink, updateDistributionLink, executeImport } from '../api/distribution';
import { resolveCostPrice } from '@/shared/utils/price-compat';
import { extractApiErrorCode, resolveApiErrorMessage } from '@/utils/error-code';

interface UseLibraryEditSubmitOptions {
  userStore: any;
  list: Ref<any[]>;
  loadData: () => Promise<void>;
  importLink: Ref<string>;
  showEdit: Ref<boolean>;
  editMode: Ref<'CREATE' | 'UPDATE'>;
  editPreview: Ref<any>;
  editForm: Ref<any>;
}

export function useLibraryEditSubmit(options: UseLibraryEditSubmitOptions) {
  const resolveCreateFeedback = (
    createdNode: any,
    beforeList: any[],
    afterList: any[],
  ) => {
    const nodeId = String(createdNode?.id || '');
    if (!nodeId) {
      return { title: '导入已提交，请刷新后查看', icon: 'none' as const };
    }
    const existsAfter = afterList.some((item) => String(item.id) === nodeId);
    if (!existsAfter) {
      return { title: '导入成功，但当前分组未显示', icon: 'none' as const };
    }
    return { title: '导入服务成功', icon: 'success' as const };
  };

  const buildPayload = () => {
    const base = resolveCostPrice(
      options.editPreview.value.service as Record<string, unknown>,
      'library_edit_submit_cost',
    );
    const val = Number(options.editForm.value.markup_value) || 0;
    const calcAmount = options.editForm.value.markup_type === 'PERCENT' ? Math.round(base * (val / 100)) : val;

    return {
      markup_amount: calcAmount,
      markup_type: options.editForm.value.markup_type,
      markup_value: val,
      alias: options.editForm.value.alias,
      private_notes: options.editForm.value.private_notes || '',
      public_notes: options.editForm.value.instructions || options.editForm.value.public_notes || '',
      token: options.editForm.value.token,
      import_as_child: options.editForm.value.importAsChild,
    } as any;
  };

  const handleLimitError = (e: any) => {
    const errorCode = extractApiErrorCode(e);
    const activeCount = Number(e?.active_count ?? e?.data?.active_count);
    const activeLimit = Number(e?.active_limit ?? e?.data?.active_limit);
    if (errorCode === 'COLLECTION_ACTIVE_LIMIT_EXCEEDED' && Number.isFinite(activeCount) && Number.isFinite(activeLimit)) {
      uni.showToast({
        title: `已达上限(${activeCount}/${activeLimit})，请先扩容或下架`,
        icon: 'none',
      });
      return true;
    }
    return false;
  };

  const confirmEdit = async () => {
    if (!options.editPreview.value) return;
    const payload = buildPayload();
    try {
      if (options.editMode.value === 'CREATE') {
          if (options.editPreview.value.token) {
             payload.token = options.editPreview.value.token;
             payload.import_as_child = options.editPreview.value.importAsChild;
          } else if (options.editPreview.value.parentNodeId) {
            payload.serviceId = options.editPreview.value.serviceId;
            payload.parentNodeId = options.editPreview.value.parentNodeId;
          } else if (options.editPreview.value.listingId) {
          payload.listingId = options.editPreview.value.listingId;
        } else if (options.editPreview.value.serviceId) {
          payload.serviceId = options.editPreview.value.serviceId;
        } else if (options.editPreview.value.service?.id) {
          payload.serviceId = options.editPreview.value.service.id;
        }

        if (!payload.listingId && !payload.serviceId && !payload.token) {
          uni.showToast({ title: '无效的服务ID', icon: 'none' });
          return;
        }

        let createResult: any;
        if (payload.token) {
          createResult = await executeImport({
            token: payload.token,
            force: false,
            import_as_child: payload.import_as_child
          });
        } else {
          createResult = await createDistributionLink(payload);
        }
        const beforeList = [...options.list.value];
        const createdNode =
          createResult?.collection ||
          createResult?.data?.collection ||
          createResult?.data ||
          createResult;

        const auth = createResult?.auth;
        if (auth?.access_token && auth?.user) {
          options.userStore.login(auth.user, auth.access_token, auth.refresh_token || '');
        }
        options.userStore.invalidate();
        options.showEdit.value = false;
        options.editPreview.value = null;
        options.importLink.value = '';
        await options.loadData();
        const feedback = resolveCreateFeedback(createdNode, beforeList, options.list.value);
        uni.showToast({ title: feedback.title, icon: feedback.icon });
        return;
      } else {
        const res: any = await updateDistributionLink(options.editPreview.value.id, payload);
        const idx = options.list.value.findIndex((i) => i.id === options.editPreview.value.id);
        if (idx > -1 && res) {
          const originalService = options.list.value[idx].service;
          options.list.value[idx] = { ...options.list.value[idx], ...res };
          if (originalService) options.list.value[idx].service = originalService;
          options.list.value[idx].markup_type = res.markup_type;
          options.list.value[idx].markup_value = Number(res.markup_value);
          options.list.value[idx].markup_amount = Number(res.markup_amount);
          const base = resolveCostPrice(
            options.list.value[idx].service as Record<string, unknown>,
            'library_edit_submit_local_recalc_cost',
          );
          options.list.value[idx].cache_total_price = base + Number(res.markup_amount || 0);
          options.list.value[idx].private_notes = res.private_notes;
          options.list.value[idx].public_notes = res.public_notes;
        }
        uni.showToast({ title: '已保存', icon: 'success' });
      }

      options.showEdit.value = false;
      options.editPreview.value = null;
    } catch (e: any) {
      console.error(e);
      if (handleLimitError(e)) return;
      const msg = resolveApiErrorMessage(
        e,
        options.editMode.value === 'CREATE' ? '导入失败' : '保存失败',
      ).message;
      uni.showToast({
        title: msg || (options.editMode.value === 'CREATE' ? '导入失败' : '保存失败'),
        icon: 'none',
      });
    }
  };

  const confirmSaveAsCopy = async () => {
    if (!options.editPreview.value) return;
    const payload = buildPayload();
    const serviceId = options.editPreview.value.service_id || options.editPreview.value.service?.id;
    const parentNodeId =
      options.editPreview.value.id ||
      options.editPreview.value.parentNodeId ||
      options.editPreview.value.parent_node_id ||
      undefined;
    if (!serviceId) {
      uni.showToast({ title: '无效的服务ID', icon: 'none' });
      return;
    }
    payload.serviceId = serviceId;
    if (parentNodeId) payload.parentNodeId = parentNodeId;

    try {
      await createDistributionLink(payload);
      uni.showToast({ title: '复制另存成功', icon: 'success' });
      options.userStore.invalidate();
      options.showEdit.value = false;
      options.editPreview.value = null;
      options.loadData();
    } catch (e: any) {
      console.error(e);
      if (handleLimitError(e)) return;
      const msg = resolveApiErrorMessage(e, '复制另存失败').message;
      uni.showToast({ title: msg || '复制另存失败', icon: 'none' });
    }
  };

  return {
    confirmEdit,
    confirmSaveAsCopy,
  };
}
