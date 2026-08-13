import { ref, type Ref } from 'vue';
import { request } from '@/utils/request';
import { resolveApiErrorMessage } from '@/utils/error-code';

interface ProfileForm {
  username: string;
  email: string;
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface UseProfileEditorActionsOptions {
  userStore: any;
  profileForm: ProfileForm;
  passwordForm: PasswordForm;
  passwordSectionExpanded: Ref<boolean>;
  onSaved: () => void;
  onClose: () => void;
  resetPasswordForm: () => void;
}

export function useProfileEditorActions(options: UseProfileEditorActionsOptions) {
  const savingProfile = ref(false);
  const savingPassword = ref(false);

  const togglePasswordSection = () => {
    options.passwordSectionExpanded.value = !options.passwordSectionExpanded.value;
    if (!options.passwordSectionExpanded.value) {
      options.resetPasswordForm();
    }
  };

  const submitProfile = async () => {
    if (!options.userStore.userInfo?.id) return;
    savingProfile.value = true;
    try {
      const res: any = await request({
        url: `/users/${options.userStore.userInfo.id}`,
        method: 'PATCH',
        data: {
          username: options.profileForm.username,
          email: options.profileForm.email,
        },
      });
      options.userStore.setUserInfo({ ...options.userStore.userInfo, ...res });
      uni.showToast({ title: '保存成功', icon: 'success' });
      options.onSaved();
      options.onClose();
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '保存失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      savingProfile.value = false;
    }
  };

  const submitPassword = async () => {
    if (!options.passwordForm.oldPassword || !options.passwordForm.newPassword || !options.passwordForm.confirmPassword) {
      uni.showToast({ title: '请填写完整', icon: 'none' });
      return;
    }
    if (options.passwordForm.newPassword !== options.passwordForm.confirmPassword) {
      uni.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    savingPassword.value = true;
    try {
      await request({
        url: '/users/change-password',
        method: 'POST',
        data: {
          oldPassword: options.passwordForm.oldPassword,
          newPassword: options.passwordForm.newPassword,
        },
      });
      options.resetPasswordForm();
      options.passwordSectionExpanded.value = false;
      uni.showToast({ title: '修改成功', icon: 'success' });
    } catch (e: any) {
      const { message: msg } = resolveApiErrorMessage(e, '修改失败');
      uni.showToast({ title: msg, icon: 'none' });
    } finally {
      savingPassword.value = false;
    }
  };

  return {
    savingProfile,
    savingPassword,
    togglePasswordSection,
    submitProfile,
    submitPassword,
  };
}
