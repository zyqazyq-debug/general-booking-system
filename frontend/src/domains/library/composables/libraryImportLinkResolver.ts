import { extractApiErrorCode, resolveApiErrorMessage } from '@/utils/error-code';
import { getServiceDetail } from '@/shared/api/service';
import { resolveDistributionLink } from '../api/distribution';
import { extractImportCode } from '@/shared/utils/import-link';

export interface LibraryResolvedImportTarget {
  token: string;
  serviceId: string;
  parentNodeId?: string;
  service: any;
}

export const resolveLibraryImportTarget = async (input: string) => {
  const token = extractImportCode(input);
  if (!token) {
    uni.showToast({ title: '无效的链接', icon: 'none' });
    return null;
  }

  try {
    uni.showLoading({ title: '解析链接...' });
    const slugRes = await resolveDistributionLink(token);
    if (!slugRes?.importInfo?.serviceId) {
      uni.hideLoading();
      uni.showToast({ title: '无效的链接', icon: 'none' });
      return null;
    }

    const serviceId = slugRes.importInfo.serviceId;
    let serviceForPreview: any = slugRes.service || null;
    try {
      const detail = await getServiceDetail(serviceId);
      serviceForPreview = { ...(detail || {}), ...(slugRes.service || {}), id: serviceId };
    } catch {
      void 0;
    }

    uni.hideLoading();
    return {
      token,
      serviceId,
      parentNodeId: slugRes.importInfo.parentNodeId,
      service: serviceForPreview,
    } satisfies LibraryResolvedImportTarget;
  } catch (e: any) {
    uni.hideLoading();
    const code = extractApiErrorCode(e);
    if (code === 'LINK_NOT_FOUND' || String(e?.statusCode || e?.status || '') === '404') {
      uni.showToast({ title: '抱歉，该分享链接已失效或不存在', icon: 'none' });
      return null;
    }
    const msg = resolveApiErrorMessage(e, '链接解析失败').message;
    uni.showToast({ title: msg || '链接解析失败', icon: 'none' });
    return null;
  }
};
