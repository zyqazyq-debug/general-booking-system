import { computed, ref } from 'vue';
import { getShareLink } from '@/domains/distribution';
import {
  createDistributionLink,
  importCheck,
  reparentDistributionLink,
  resolveDistributionLink,
} from '@/domains/library';
import { getServiceDetail } from '@/domains/provider';
import { extractImportCode } from '@/shared/utils/import-link';
import { resolveApiErrorMessage } from '@/utils/error-code';

const createImportForm = () => ({
  alias: '',
  markup_type: 'FIXED',
  markup_value: 0,
  private_notes: '',
  instructions: '',
});

const normalizeServicePreview = async (serviceId: string, fallback?: Record<string, any>): Promise<any> => {
  try {
    const detail = await getServiceDetail(serviceId);
    return { ...(detail || {}), ...(fallback || {}), id: serviceId };
  } catch {
    return { ...(fallback || {}), id: serviceId };
  }
};

export function useScheduleCollectionImport(loadData: () => Promise<void>) {
  const showImport = ref(false);
  const importType = ref<'NEW' | 'REPARENT'>('NEW');
  const reparentTargetId = ref('');
  const importLink = ref('');
  const showBatchImport = ref(false);
  const importBatchList = ref<any[]>([]);
  const showImportEdit = ref(false);
  const importPreview = ref<any>(null);
  const importForm = ref<any>(createImportForm());
  const isResolving = ref(false);

  const previewImportPrice = computed(() => {
    if (!importPreview.value) return 0;
    const base = Number(importPreview.value.base_price) || Number(importPreview.value.price) || 0;
    const value = Number(importForm.value.markup_value) || 0;
    return importForm.value.markup_type === 'PERCENT'
      ? (base * (1 + value / 100)).toFixed(2)
      : (base + value).toFixed(2);
  });

  const setImportType = (type: 'FIXED' | 'PERCENT') => {
    importForm.value.markup_type = type;
  };

  const openReparent = (item: any) => {
    importType.value = 'REPARENT';
    reparentTargetId.value = item.id;
    importLink.value = '';
    showImport.value = true;
  };

  const openImportEdit = (preview: any, formPatch: Record<string, any> = {}) => {
    importPreview.value = preview;
    importForm.value = {
      ...createImportForm(),
      alias: preview?.title || preview?.service?.title || '',
      ...formPatch,
    };
    showImport.value = false;
    showImportEdit.value = true;
  };

  const resolveDistributionImport = async (code: string) => {
    try {
      const checkRes = await importCheck(code);
      if (!checkRes?.service_id) {
        return checkRes?.parent_id ? { kind: 'distribution-check', parentNodeId: checkRes.parent_id } : null;
      }
      const service = await normalizeServicePreview(checkRes.service_id);
      return {
        kind: 'distribution-check',
        parentNodeId: checkRes.parent_id || '',
        serviceId: checkRes.service_id,
        preview: {
          ...service,
          parentNodeId: checkRes.parent_id || '',
          serviceId: checkRes.service_id,
        },
      };
    } catch {
      return null;
    }
  };

  const resolveSlugImport = async (code: string) => {
    try {
      const response: any = await resolveDistributionLink(code);
      if (!response?.importInfo?.serviceId) return null;
      const service: any = await normalizeServicePreview(response.importInfo.serviceId, response.service);
      return {
        kind: 'distribution-slug',
        parentNodeId: response.importInfo.parentNodeId || '',
        serviceId: response.importInfo.serviceId,
        preview: {
          ...service,
          base_price: response.importInfo.costPrice ?? service.base_price,
          parentNodeId: response.importInfo.parentNodeId || '',
          serviceId: response.importInfo.serviceId,
        },
      };
    } catch {
      return null;
    }
  };

  const resolveShareImport = async (code: string) => {
    try {
      const response: any = await getShareLink(code);
      if (!response?.valid) return null;
      if (response.type === 'BATCH' && Array.isArray(response.data)) {
        return {
          kind: 'share-batch',
          items: response.data,
        };
      }
      if (response.type !== 'SINGLE' || !response.data || Array.isArray(response.data)) {
        return null;
      }

      const serviceId = String(response.data.source_service_id || '');
      return {
        kind: 'share-single',
        serviceId,
        listingId: response.data.listing_id,
        preview: {
          ...response.data,
          id: serviceId || response.data.listing_id,
          serviceId,
          listing_id: response.data.listing_id,
        },
      };
    } catch {
      return null;
    }
  };

  const handleImport = async () => {
    if (!importLink.value) {
      return uni.showToast({ title: '请输入链接', icon: 'none' });
    }
    if (isResolving.value) return;

    const code = extractImportCode(importLink.value);
    if (!code) {
      return uni.showToast({ title: '无效的链接', icon: 'none' });
    }

    try {
      isResolving.value = true;
      uni.showLoading({ title: importType.value === 'REPARENT' ? '检查链接...' : '解析链接...' });

      const distributionResult = await resolveDistributionImport(code);
      const slugResult = (distributionResult as any)?.preview ? null : await resolveSlugImport(code);
      const shareResult =
        (slugResult as any)?.preview || importType.value === 'REPARENT'
          ? null
          : await resolveShareImport(code);
      const resolved: any = distributionResult || slugResult || shareResult;

      uni.hideLoading();

      if (!resolved) {
        uni.showToast({ title: '无效的链接', icon: 'none' });
        return;
      }

      if (importType.value === 'REPARENT') {
        if (resolved.kind === 'share-batch') {
          uni.showToast({ title: '批量分享不支持换源', icon: 'none' });
          return;
        }
        await reparentDistributionLink(reparentTargetId.value, resolved.parentNodeId || '');
        uni.showToast({ title: '换源成功', icon: 'success' });
        showImport.value = false;
        await loadData();
        return;
      }

      if (resolved.kind === 'share-batch') {
        importBatchList.value = resolved.items;
        importForm.value = createImportForm();
        showImport.value = false;
        showBatchImport.value = true;
        return;
      }

      openImportEdit(resolved.preview, {
        parentNodeId: resolved.parentNodeId || '',
        serviceId: resolved.serviceId || resolved.preview?.serviceId || resolved.preview?.id || '',
        listingId: resolved.listingId || resolved.preview?.listing_id,
      });
    } catch (error: any) {
      uni.hideLoading();
      console.error(error);
      const message = resolveApiErrorMessage(error, '链接解析失败').message;
      uni.showToast({ title: message || '链接解析失败', icon: 'none' });
    } finally {
      isResolving.value = false;
    }
  };

  const confirmBatchImport = async () => {
    if (!importBatchList.value.length) return;

    try {
      uni.showLoading({ title: '批量导入中...' });
      let successCount = 0;
      const value = Number(importForm.value.markup_value) || 0;

      for (const item of importBatchList.value) {
        try {
          await createDistributionLink({
            listingId: item.listing_id,
            markup_type: importForm.value.markup_type,
            markup_value: value,
          });
          successCount += 1;
        } catch (error) {
          console.error(`Failed to import ${item.listing_id}`, error);
        }
      }

      uni.hideLoading();
      uni.showToast({ title: `成功导入 ${successCount} 个服务`, icon: 'success' });
      showBatchImport.value = false;
      importBatchList.value = [];
      await loadData();
    } catch (error) {
      uni.hideLoading();
      console.error(error);
      uni.showToast({ title: '部分导入失败', icon: 'none' });
    }
  };

  const confirmImport = async () => {
    if (!importPreview.value) return;

    try {
      const combinedNotes = [
        importForm.value.instructions ? `说明：${importForm.value.instructions}` : '',
        importForm.value.private_notes ? `备注：${importForm.value.private_notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const base = Number(importPreview.value.base_price) || 0;
      const value = Number(importForm.value.markup_value) || 0;
      const markupAmount = importForm.value.markup_type === 'PERCENT' ? Math.round(base * (value / 100)) : value;
      const payload: any = {
        markup_amount: markupAmount,
        markup_type: importForm.value.markup_type,
        markup_value: value,
        alias: importForm.value.alias,
        private_notes: combinedNotes,
      };

      if (importForm.value.parentNodeId) {
        payload.serviceId = importForm.value.serviceId;
        payload.parentNodeId = importForm.value.parentNodeId;
      } else if (importForm.value.listingId || importPreview.value.listing_id) {
        payload.listingId = importForm.value.listingId || importPreview.value.listing_id;
      } else {
        payload.serviceId = importForm.value.serviceId || importPreview.value.serviceId || importPreview.value.id;
      }

      if (!payload.listingId && !payload.serviceId) {
        uni.showToast({ title: '无效的服务ID', icon: 'none' });
        return;
      }

      await createDistributionLink(payload);
      uni.showToast({ title: '导入成功', icon: 'success' });
      showImportEdit.value = false;
      importLink.value = '';
      importPreview.value = null;
      await loadData();
    } catch (error) {
      console.error(error);
      uni.showToast({ title: '导入失败', icon: 'none' });
    }
  };

  const scanImport = () => {
    uni.scanCode({
      success: (result) => {
        importLink.value = result.result;
        void handleImport();
      },
    });
  };

  return {
    showImport,
    importType,
    reparentTargetId,
    importLink,
    showBatchImport,
    importBatchList,
    showImportEdit,
    importPreview,
    importForm,
    previewImportPrice,
    setImportType,
    openReparent,
    handleImport,
    confirmBatchImport,
    confirmImport,
    scanImport,
  };
}
