import { reactive, ref, type Ref, watch } from 'vue';

interface UseProfileEditorStateOptions {
  visible: Ref<boolean>;
  userStore: any;
}

export function useProfileEditorState(options: UseProfileEditorStateOptions) {
  const passwordSectionExpanded = ref(false);

  const profileForm = reactive({
    username: '',
    email: '',
  });

  const passwordForm = reactive({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const fillProfileForm = () => {
    profileForm.username = options.userStore.userInfo?.username || '';
    profileForm.email = options.userStore.userInfo?.email || '';
  };

  const resetPasswordForm = () => {
    passwordForm.oldPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
  };

  watch(
    options.visible,
    (val) => {
      if (val) {
        fillProfileForm();
      }
    },
    { immediate: true },
  );

  return {
    profileForm,
    passwordForm,
    passwordSectionExpanded,
    resetPasswordForm,
  };
}
