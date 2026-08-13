<template>
  <view v-if="visible" class="debug-console" :class="{ minimized: isMinimized }">
    <view class="debug-header" @click="toggleMinimize">
      <text class="title">Debug Console</text>
      <view class="controls">
        <text class="control-action" @click.stop="clearLogs">Clear</text>
        <text class="control-action" @click.stop="copyLogs">Copy</text>
        <text class="control-action close" @click.stop="close">X</text>
      </view>
    </view>

    <view v-if="!isMinimized" class="debug-info">
      <view class="info-item">
        <text class="label">Token:</text>
        <text class="value">{{ userStore.token ? userStore.token.substring(0, 15) + '...' : 'None' }}</text>
      </view>
      <view class="info-item">
        <text class="label">TG InitData:</text>
        <text class="value wrap-text">{{ debugInitData }}</text>
      </view>
      <view class="info-item">
        <text class="label">TG Hash:</text>
        <text class="value">{{ debugHash }}</text>
      </view>
      <view class="info-item">
        <text class="label">Auth Date:</text>
        <text class="value">{{ debugAuthDate }}</text>
      </view>
    </view>

    <scroll-view v-if="!isMinimized" scroll-y class="debug-content" :scroll-top="scrollTop">
      <view v-for="(log, index) in logs" :key="index" class="log-item" :class="log.type">
        <text class="time">[{{ log.time }}]</text>
        <text class="msg">{{ log.message }}</text>
      </view>
    </scroll-view>
  </view>
  <view v-else class="debug-trigger" @click="visible = true">🐞</view>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useUserStore } from '@/shared/stores/user';

const userStore = useUserStore();

const visible = ref(false);
const isMinimized = ref(false);
const logs = ref<Array<{ time: string, type: string, message: string }>>([]);
const scrollTop = ref(0);

const debugInitData = ref('');
const debugHash = ref('');
const debugAuthDate = ref('');

// Listen for global TG events
uni.$on('TG_INIT_DATA', (data: any) => {
    debugInitData.value = data.initData || '';
    debugHash.value = data.hash || '';
    debugAuthDate.value = data.authDate || '';
});

const addLog = (type: string, args: any[]) => {
  const time = new Date().toLocaleTimeString();
  const message = args.map(arg => {
    try {
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    } catch (e) {
      return String(arg);
    }
  }).join(' ');
  
  logs.value.push({ time, type, message });
  if (logs.value.length > 100) logs.value.shift();
  
  nextTick(() => {
    scrollTop.value = 99999;
  });
};

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value;
};

const clearLogs = () => {
  logs.value = [];
};

const copyLogs = () => {
  const content = logs.value.map(l => `[${l.time}] [${l.type}] ${l.message}`).join('\n');
  uni.setClipboardData({
    data: content,
    success: () => uni.showToast({ title: 'Copied', icon: 'none' })
  });
};

const close = () => {
  visible.value = false;
};

onMounted(() => {
  // Intercept console
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    addLog('log', args);
    originalLog.apply(console, args);
  };

  console.error = (...args) => {
    addLog('error', args);
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    addLog('warn', args);
    originalWarn.apply(console, args);
  };
  
  // Capture unhandled errors
  uni.onError((err) => {
      console.error('Global Error:', err);
  });
});
</script>

<style lang="scss" scoped>
.debug-console {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 40vh;
  background: rgba(0, 0, 0, 0.85);
  color: #0f0;
  z-index: $uni-z-debug;
  font-family: monospace;
  font-size: 12px;
  display: flex;
  flex-direction: column;
}

.debug-console.minimized {
  height: 40px;
  width: auto;
  right: 0;
  left: auto;
  border-top-left-radius: 8px;
}

.debug-header {
  padding: 8px;
  background: #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.title {
  font-weight: bold;
  color: $uni-bg-color;
}

.controls {
  display: flex;
  gap: 8px;
}

.control-action {
  padding: 2px 6px;
  background: #555;
  border-radius: $uni-radius-sm;
  color: $uni-bg-color;
  font-size: 10px;
}

.control-action.close {
  background: #c00;
}

.debug-content {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.log-item {
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 2px;
  word-break: break-all;
}

.log-item.error { color: #ff5555; }
.log-item.warn { color: #ffff55; }

.debug-trigger {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: $uni-radius-circle;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $uni-bg-color;
  font-size: 20px;
  z-index: $uni-z-debug;
  cursor: pointer;
}
</style>
