import { reactive, ref } from 'vue';
import { sendSmsCodeApi } from '../../../../api/auth';
import { bindIdentityApi, confirmIdentityMergeApi } from '../../../../api/identity';
import { resolveApiErrorMessage, extractApiErrorCode } from '@/utils/error-code';
import { showAppConfirm } from '@/utils/app-confirm';

interface UseProfilePhoneMergeOptions {
  userStore: any;
  onSaved: () => void;
  onClose: () => void;
}

export function useProfilePhoneMerge(options: UseProfilePhoneMergeOptions) {
  const showMergeModal = ref(false);
  const mergingAccount = ref(false);
  const sendingCode = ref(false);
  const countdown = ref(0);
  const mergeForm = reactive({
    phone: '',
    code: '',
  });
  let timer: any = null;

  const bindPhone = () => {
    showMergeModal.value = true;
    mergeForm.phone = options.userStore.userInfo?.phone || '';
    mergeForm.code = '';
  };

  const sendMergeCode = async () => {
    if (!mergeForm.phone) {
      uni.showToast({ title: '请输入手机号', icon: 'none' });
      return;
    }
    if (mergeForm.phone.length !== 11) {
      uni.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }
    sendingCode.value = true;
    try {
      await sendSmsCodeApi(mergeForm.phone, 'merge');
      uni.showToast({ title: '验证码已发送', icon: 'none' });
      countdown.value = 60;
      timer = setInterval(() => {
        countdown.value -= 1;
        if (countdown.value <= 0) {
          clearInterval(timer);
        }
      }, 1000);
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '发送失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      sendingCode.value = false;
    }
  };

  const confirmMergePrompt = async () => {
    const res = await showAppConfirm({
      title: '合并提示',
      content: '该手机号已被注册。如果继续合并，另一个账号中的资产、订单、积分等所有数据将永久合并到当前账号。请确认另一个账号属于您且可以合并。',
      confirmText: '确认合并',
      cancelText: '取消',
    });
    return !!res.confirm;
  };

  const submitMerge = async () => {
    if (!mergeForm.phone || !mergeForm.code) {
      uni.showToast({ title: '请填写完整', icon: 'none' });
      return;
    }
    mergingAccount.value = true;
    try {
      const beforeUserId = options.userStore.userInfo?.id;
      let res: any;
      try {
        res = await bindIdentityApi({
          provider: 'phone',
          identity: mergeForm.phone,
          code: mergeForm.code,
        });
        if (res?.status === 'bound') {
          options.userStore.login(res.user, res.access_token, res.refresh_token || '');
          const switched = beforeUserId && res?.user?.id && res.user.id !== beforeUserId;
          uni.showToast({ title: switched ? '已合并并切换账号' : '绑定成功', icon: 'success' });
          showMergeModal.value = false;
          options.onClose();
          options.onSaved();
          return;
        }
        if (res?.status !== 'merge_required') throw new Error('操作失败');
        if (!(await confirmMergePrompt())) return;
        res = await confirmIdentityMergeApi({
          provider: 'phone',
          identity: mergeForm.phone,
          code: mergeForm.code,
        });
      } catch (e: any) {
        const errorCode = extractApiErrorCode(e);
        if (errorCode !== 'PHONE_ALREADY_BOUND') {
          const { message: msg } = resolveApiErrorMessage(e, '绑定失败');
          uni.showToast({ title: msg, icon: 'none' });
          return;
        }
        if (!(await confirmMergePrompt())) return;
        res = await confirmIdentityMergeApi({
          provider: 'phone',
          identity: mergeForm.phone,
          code: mergeForm.code,
        });
      }

      if (!res) return;
      options.userStore.login(res.user, res.access_token, res.refresh_token || '');
      const switched = beforeUserId && res?.user?.id && res.user.id !== beforeUserId;
      uni.showToast({ title: switched ? '已合并并切换账号' : '绑定成功', icon: 'success' });
      showMergeModal.value = false;
      options.onClose();
      options.onSaved();
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '操作失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      mergingAccount.value = false;
    }
  };

  const cleanup = () => {
    if (timer) clearInterval(timer);
  };

  return {
    showMergeModal,
    mergingAccount,
    sendingCode,
    countdown,
    mergeForm,
    bindPhone,
    sendMergeCode,
    submitMerge,
    cleanup,
  };
}
