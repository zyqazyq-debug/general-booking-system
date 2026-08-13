import { importCheck } from '../api/distribution';

export const runLibraryImportPrecheck = async (token: string) => {
  uni.showLoading({ title: '检查中...' });
  try {
    return await importCheck(token);
  } finally {
    uni.hideLoading();
  }
};
