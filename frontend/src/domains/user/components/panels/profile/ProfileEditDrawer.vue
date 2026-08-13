<template>
    <AppModal
        :visible="visible"
        :title="t('profile.edit_profile')"
        variant="workspace"
        @close="handleClose"
    >
        <view class="drawer-body">
            <ProfileBindAccountsSection
                :t="t"
                :user-store="userStore"
                :telegram-account-display="telegramAccountDisplay"
                :wechat-account-display="wechatAccountDisplay"
                :qq-account-display="qqAccountDisplay"
                @bind-phone="bindPhone"
                @open-provider="openIdentityBindModal"
                @unbind-provider="handleUnbind"
            />

            <ProfileBasicInfoSection
                :t="t"
                :saving-profile="savingProfile"
                :profile-form="profileForm"
                @submit="submitProfile"
            />

            <ProfilePasswordSection
                :t="t"
                :expanded="passwordSectionExpanded"
                :saving-password="savingPassword"
                :password-form="passwordForm"
                @toggle="togglePasswordSection"
                @submit="submitPassword"
            />
        </view>

        <ProfilePhoneMergeModal
            :visible="showMergeModal"
            :title="phoneModalTitle"
            :merge-form="mergeForm"
            :sending-code="sendingCode"
            :countdown="countdown"
            :merging-account="mergingAccount"
            @update:visible="showMergeModal = $event"
            @send-code="sendMergeCode"
            @submit="submitMerge"
        />

        <ProfileIdentityBindModal
            :visible="showIdentityModal"
            :title="identityModalTitle"
            :hint="identityModalHint"
            :current-bind-provider="currentBindProvider"
            :identity-scan-bot-info="identityScanBotInfo"
            :identity-scan-ticket-id="identityScanTicketId"
            :binding-identity="bindingIdentity"
            :identity-scan-qr-url="identityScanQrUrl"
            :is-mobile="isMobile"
            :provider-label-map="providerLabelMap"
            @update:visible="showIdentityModal = $event"
            @close="closeIdentityBindModal"
            @start-scan="startIdentityScan"
            @check-status="checkIdentityScanStatus"
            @open-telegram-link="openTelegramLink"
            @open-telegram-web="openTelegramWeb"
        />
    </AppModal>
</template>

<script setup lang="ts">
import { toRef, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUserStore } from '@/shared/stores/user';
import UQRCode from 'uqrcodejs';
import AppModal from '@/components/AppModal.vue';
import { useProfileIdentityBinding } from './composables/useProfileIdentityBinding';
import { useProfileEditorActions } from './composables/useProfileEditorActions';
import { useProfileEditorState } from './composables/useProfileEditorState';
import ProfileBindAccountsSection from './components/ProfileBindAccountsSection.vue';
import ProfileBasicInfoSection from './components/ProfileBasicInfoSection.vue';
import ProfilePasswordSection from './components/ProfilePasswordSection.vue';
import ProfilePhoneMergeModal from './components/ProfilePhoneMergeModal.vue';
import ProfileIdentityBindModal from './components/ProfileIdentityBindModal.vue';

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits(['update:visible', 'saved']);

const userStore = useUserStore();
const { t } = useI18n();

const {
  profileForm,
  passwordForm,
  passwordSectionExpanded,
  resetPasswordForm,
} = useProfileEditorState({
  visible: toRef(props, 'visible'),
  userStore,
});

const handleClose = () => {
    emit('update:visible', false);
    passwordSectionExpanded.value = false;
    resetPasswordForm();
};

const {
  savingProfile,
  savingPassword,
  togglePasswordSection,
  submitProfile,
  submitPassword,
} = useProfileEditorActions({
  userStore,
  profileForm,
  passwordForm,
  passwordSectionExpanded,
  onSaved: () => emit('saved'),
  onClose: handleClose,
  resetPasswordForm,
});

const generateQR = async (data: string) => {
    await nextTick();
    try {
        const instance = getCurrentInstance();
        const ctx = uni.createCanvasContext('tg-bind-qr', instance?.proxy || instance);
        
        const qr = new UQRCode();
        qr.data = data;
        qr.size = 180;
        qr.make();
        qr.canvasContext = ctx;
        qr.drawCanvas();
    } catch (e) {
        console.error('QR Gen Error:', e);
    }
};

const {
  showMergeModal,
  showIdentityModal,
  identityScanQrUrl,
  identityScanBotInfo,
  isMobile,
  mergingAccount,
  bindingIdentity,
  sendingCode,
  countdown,
  currentBindProvider,
  mergeForm,
  identityScanTicketId,
  phoneModalTitle,
  telegramAccountDisplay,
  wechatAccountDisplay,
  qqAccountDisplay,
  providerLabelMap,
  identityModalTitle,
  identityModalHint,
  bindPhone,
  openIdentityBindModal,
  handleUnbind,
  openTelegramLink,
  openTelegramWeb,
  closeIdentityBindModal,
  sendMergeCode,
  submitMerge,
  startIdentityScan,
  checkIdentityScanStatus,
  cleanup,
} = useProfileIdentityBinding({
  t,
  userStore,
  onSaved: () => emit('saved'),
  onClose: handleClose,
  onGenerateQr: (data) => {
    void generateQR(data);
  },
});

onUnmounted(() => {
    cleanup();
});

</script>

<style lang="scss" scoped>
.drawer-body {
    padding: 16px;
    background-color: $uni-bg-color-grey;
    min-height: 100%;
}
</style>
