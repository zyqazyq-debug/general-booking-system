<template>
  <AppModal
    :visible="visible"
    title="Telegram 登录"
    @update:visible="emit('update:visible', $event)"
    @close="close"
  >
      <view class="modal-body text-center">
        <view class="widget-section" :class="{ 'hidden': showFallback }">
          <view id="telegram-login-container" class="telegram-container">
            <view v-if="loadingWidget" class="loading-spinner">
              <view class="spinner"></view>
              <text class="loading-text">{{ t('login.telegram_widget_loading') }}</text>
            </view>
          </view>
          <text class="text-muted mt-2">{{ t('login.telegram_widget_tap_hint') }}</text>
        </view>

        <view v-if="showFallback" class="fallback-section">
          <view class="fallback-icon">✈️</view>
          <text class="fallback-title">{{ t('login.telegram_widget_fail_title') }}</text>
          <text class="fallback-desc">{{ t('login.telegram_widget_fail_desc') }}</text>
          
          <view class="action-buttons">
            <button class="telegram-action-deep-link" @click="openTelegramApp">
              {{ t('login.telegram_open_app') }}
            </button>
            <button class="telegram-action-retry" @click="retryWidget">
              {{ t('login.telegram_retry') }}
            </button>
          </view>
          
          <view v-if="isPolling" class="polling-status">
            <view class="spinner-sm"></view>
            <text>{{ t('login.telegram_waiting_auth') }}</text>
          </view>
        </view>
      </view>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { getBotName } from '@/utils/env';
import { getTelegramLoginTicketApi, checkIdentityScanStatusApi } from '@/domains/user';
import { useUserStore } from '@/shared/stores/user';
import { useI18n } from 'vue-i18n';
import AppModal from '@/components/AppModal.vue';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits(['update:visible', 'success']);

const userStore = useUserStore();
const { t } = useI18n();
const loadingWidget = ref(true);
const showFallback = ref(false);
const isPolling = ref(false);
const loginTicket = ref('');
const botUrl = ref('');

let widgetTimer: any = null;
let pollTimer: any = null;

const close = () => {
    stopPolling();
    emit('update:visible', false);
};

const initTelegramWidget = () => {
    loadingWidget.value = true;
    showFallback.value = false;
    
    const container = document.getElementById('telegram-login-container');
    if (container) {
        // Clear previous
        const oldScripts = container.querySelectorAll('script');
        oldScripts.forEach(s => s.remove());
        const iframes = container.querySelectorAll('iframe');
        iframes.forEach(i => i.remove());

        const script = document.createElement('script');
        script.async = true;
        script.src = "https://telegram.org/js/telegram-widget.js?22";
        
        const botName = getBotName();
        script.setAttribute('data-telegram-login', botName);
        script.setAttribute('data-size', 'large');
        script.setAttribute('data-onauth', 'onTelegramAuth(user)');
        script.setAttribute('data-request-access', 'write');
        
        // Success detection (hacky but works for most cases)
        script.onload = () => {
            // Give it some time to render the iframe
            setTimeout(() => {
                const iframe = container.querySelector('iframe');
                if (iframe) {
                    loadingWidget.value = false;
                    if (widgetTimer) clearTimeout(widgetTimer);
                }
            }, 1000);
        };

        container.appendChild(script);

        // Fallback timer: if not loaded in 6 seconds
        if (widgetTimer) clearTimeout(widgetTimer);
        widgetTimer = setTimeout(() => {
            if (loadingWidget.value) {
                showFallback.value = true;
                loadingWidget.value = false;
            }
        }, 6000);
    }
};

const retryWidget = () => {
    initTelegramWidget();
};

const openTelegramApp = async () => {
    try {
        if (!loginTicket.value) {
            const res = await getTelegramLoginTicketApi();
            loginTicket.value = res.ticket_id;
            botUrl.value = res.bot_url;
        }
        
        // Open deep link
        window.open(botUrl.value, '_blank');
        
        // Start polling
        startPolling();
    } catch (e) {
        console.error('Failed to get login ticket', e);
        uni.showToast({ title: t('login.telegram_link_failed'), icon: 'none' });
    }
};

const startPolling = () => {
    if (isPolling.value) return;
    isPolling.value = true;
    
    const poll = async () => {
        if (!isPolling.value) return;
        try {
            const res = await checkIdentityScanStatusApi({ ticket_id: loginTicket.value });
            if (res.status === 'success' && res.access_token) {
                userStore.login(res.user, res.access_token, res.refresh_token || '');
                stopPolling();
                emit('success');
                emit('update:visible', false);
                uni.showToast({ title: t('login.toast.login_success'), icon: 'success' });
                setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 1500);
            } else if (res.status === 'expired') {
                stopPolling();
                loginTicket.value = '';
                uni.showToast({ title: t('login.telegram_link_expired'), icon: 'none' });
            } else {
                pollTimer = setTimeout(poll, 2000);
            }
        } catch (e) {
            console.error('Polling error', e);
            pollTimer = setTimeout(poll, 5000);
        }
    };
    poll();
};

const stopPolling = () => {
    isPolling.value = false;
    if (pollTimer) clearTimeout(pollTimer);
};

watch(() => props.visible, (val) => {
    if (val) {
        setTimeout(initTelegramWidget, 100);
    } else {
        stopPolling();
    }
});

onMounted(() => {
    if (props.visible) {
        setTimeout(initTelegramWidget, 100);
    }
});

onUnmounted(() => {
    stopPolling();
    if (widgetTimer) clearTimeout(widgetTimer);
});
</script>

<style lang="scss" scoped>
.modal-body {
    &.text-center { text-align: center; }
}

.widget-section {
    min-height: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s;
    
    &.hidden {
        opacity: 0;
        height: 0;
        overflow: hidden;
        min-height: 0;
    }
}

.telegram-container {
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.loading-spinner {
    display: flex;
    flex-direction: column;
    align-items: center;
    .spinner {
        width: 30px;
        height: 30px;
        border: 3px solid $uni-border-color-light;
        border-top: 3px solid $uni-color-info;
        border-radius: $uni-radius-circle;
        animation: spin 1s linear infinite;
    }
    .loading-text {
        margin-top: 8px;
        font-size: $uni-font-size-sm;
        color: $uni-text-color-placeholder;
    }
}

.fallback-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    animation: fadeIn 0.3s ease;

    .fallback-icon { font-size: 48px; margin-bottom: 12px; }
    .fallback-title { font-size: $uni-font-size-h2; font-weight: $uni-font-weight-bold; color: $uni-text-color; margin-bottom: 8px; }
    .fallback-desc { font-size: 13px; color: $uni-text-color-secondary; margin-bottom: 20px; }
}

.action-buttons {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.telegram-action-deep-link {
    background: $uni-color-info;
    color: $uni-text-color-inverse;
    border: none;
    border-radius: $uni-radius-lg;
    padding: 12px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    &:active { background: #267dce; }
}

.telegram-action-retry {
    background: transparent;
    color: $uni-text-color-secondary;
    border: 1px solid $uni-border-color;
    border-radius: $uni-radius-lg;
    padding: 10px;
    font-size: 14px;
    cursor: pointer;
    &:active { background: $uni-bg-color-hover; }
}

.polling-status {
    margin-top: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: $uni-color-info;
}

.spinner-sm {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(59, 130, 246, 0.2);
    border-top: 2px solid $uni-color-info;
    border-radius: $uni-radius-circle;
    animation: spin 1s linear infinite;
}

@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

.text-muted { color: $uni-text-color-grey; font-size: $uni-font-size-sm; }
.mt-2 { margin-top: 12px; }
</style>
