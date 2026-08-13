import { type Ref } from 'vue';
import { createDistributionLink } from '../api/distribution';

interface UseLibraryBatchImportOptions {
  userStore: any;
  showBatchImport: Ref<boolean>;
  importBatchList: Ref<any[]>;
  editForm: Ref<any>;
  loadData: () => Promise<void>;
}

export function useLibraryBatchImport(options: UseLibraryBatchImportOptions) {
  const confirmBatchImport = async () => {
    if (!options.importBatchList.value.length) return;
    try {
      const val = Number(options.editForm.value.markup_value) || 0;

      uni.showLoading({ title: '批量导入中...' });

      let successCount = 0;
      let firstErrorMessage = '';
      for (const item of options.importBatchList.value) {
        try {
          await createDistributionLink({
            listingId: item.listing_id,
            markup_type: options.editForm.value.markup_type,
            markup_value: Number(options.editForm.value.markup_value),
            alias: options.editForm.value.alias,
            private_notes: options.editForm.value.private_notes,
            public_notes: options.editForm.value.public_notes,
          });
          successCount++;
        } catch (e: any) {
          console.error(`Failed to import ${item.listing_id}`, e);
          const errorCode = e?.error_code || e?.data?.error_code;
          if (errorCode === 'COLLECTION_ACTIVE_LIMIT_EXCEEDED') {
            const activeCount = Number(e?.active_count ?? e?.data?.active_count);
            const activeLimit = Number(e?.active_limit ?? e?.data?.active_limit);
            firstErrorMessage =
              Number.isFinite(activeCount) && Number.isFinite(activeLimit)
                ? `已达上限(${activeCount}/${activeLimit})，请先扩容或下架`
                : '已达上架收藏上限，请先扩容或下架';
            break;
          }
          if (!firstErrorMessage) {
            firstErrorMessage = String(e?.message || e?.data?.message || '');
          }
        }
      }

      uni.hideLoading();
      if (successCount > 0 && !firstErrorMessage) {
        uni.showToast({
          title: `成功导入 ${successCount} 个服务`,
          icon: 'success',
        });
        options.userStore.invalidate();
      } else if (successCount > 0) {
        uni.showToast({
          title: `已导入 ${successCount} 个，${firstErrorMessage}`,
          icon: 'none',
        });
      } else {
        uni.showToast({
          title: firstErrorMessage || '部分导入失败',
          icon: 'none',
        });
      }
      options.showBatchImport.value = false;
      options.importBatchList.value = [];
      options.loadData();
    } catch (e) {
      uni.hideLoading();
      console.error(e);
      uni.showToast({ title: '部分导入失败', icon: 'none' });
    }
  };

  return {
    confirmBatchImport,
  };
}
