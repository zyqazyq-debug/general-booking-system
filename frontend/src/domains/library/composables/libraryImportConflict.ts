export const resolveLibraryImportConflict = async (
  actionType: string,
  promptMsg?: string,
) => {
  if (actionType === 'DEPTH_BLOCKED') {
    uni.showToast({ title: promptMsg || '代理层级过多无法导入', icon: 'none' });
    return { blocked: true, importAsChild: false };
  }

  if (actionType !== 'SAME_PARENT' && actionType !== 'SELF_IN_UPSTREAM') {
    return { blocked: false, importAsChild: false };
  }

  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '导入提示',
      content: promptMsg || '检测到特殊状态，是否作为子节点继续导入？',
      confirmText: '作为子节点导入',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });

  if (!confirmed) {
    uni.showToast({ title: '已取消导入', icon: 'none' });
    return { blocked: true, importAsChild: false };
  }

  return { blocked: false, importAsChild: true };
};
