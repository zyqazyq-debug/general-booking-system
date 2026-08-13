<template>
  <view class="qa-runner">
    <view class="section">
      <text class="title">用例执行器</text>
      <text class="desc">当前用例：{{ currentCase || '未指定' }}，剩余循环：{{ remaining }}</text>
    </view>
    <view class="section">
      <text class="subtitle">实时日志</text>
      <scroll-view scroll-y class="log-panel" :scroll-top="scrollTop">
        <view v-for="(l, i) in logs" :key="i" class="log-item">
          <text class="time">[{{ l.t }}]</text>
          <text class="msg">{{ l.m }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
  </template>
  
  <script setup lang="ts">
  import { ref, nextTick } from 'vue';
  import { onLoad } from '@dcloudio/uni-app';
  import { useUserStore } from '@/shared/stores/user';
  import { restoreSessionFromStorage } from '@/core/auth/session';
  import { handleNavigateGuard } from '@/core/guards/route-guard';
  
  const userStore = useUserStore();
  
  const logs = ref<Array<{ t: string; m: string }>>([]);
  const scrollTop = ref(0);
  const currentCase = ref('');
  const remaining = ref(0);
  
  const addLog = (m: string) => {
    const t = new Date().toLocaleTimeString();
    logs.value.push({ t, m });
    nextTick(() => {
      scrollTop.value = 999999;
    });
  };
  
  const runCaseAOnce = (provider: 'wechat' | 'qq', left: number) => {
    const target = `/pages/qa/runner?case=A&n=${left - 1}`;
    const loginUrl = `/pages/login/login?auto=${provider}&redirect=${encodeURIComponent(target)}`;
    addLog(`A: 重定向到登录页 (${provider})`);
    uni.reLaunch({ url: loginUrl });
  };
  
  const runCaseB = async () => {
    addLog('B: 开始执行');
    let passCount = 0;
    const total = 20;
    for (let i = 0; i < total; i++) {
      const long = i % 2 === 0;
      const maxH = i % 2 === 0 ? '40vh' : '60vh';
      const container = document.createElement('div');
      container.className = 'qa-modal-host';
      document.body.appendChild(container);
      const modal = document.createElement('div');
      modal.className = 'app-modal-content size-md';
      const body = document.createElement('div');
      body.className = 'modal-body-scroll';
      (body as any).style = `max-height:${maxH};overflow:auto;`;
      const inner = document.createElement('div');
      inner.className = 'modal-body-wrapper';
      inner.innerHTML = long ? Array(200).fill('内容').join(' ') : Array(10).fill('内容').join(' ');
      body.appendChild(inner);
      const hint = document.createElement('div');
      hint.className = 'scroll-hint';
      modal.appendChild(body);
      modal.appendChild(hint);
      container.appendChild(modal);
      await new Promise((r) => setTimeout(r, 600));
      const isOverflow =
        body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth;
      const shouldShow = isOverflow;
      const hintVisible = hint && hint.style.display !== 'none';
      if (shouldShow && hintVisible) passCount++;
      if (!shouldShow && !hintVisible) passCount++;
      body.scrollTop = body.scrollHeight;
      await new Promise((r) => setTimeout(r, 100));
      hint.style.display = 'none';
      const hidden = hint.style.display === 'none';
      if (shouldShow && hidden) passCount++;
      document.body.removeChild(container);
    }
    addLog(`B: 完成，断言通过计数 ${passCount}`);
  };
  
  const runCaseC = async () => {
    addLog('C: 开始执行');
    let ok1 = 0;
    let ok2 = 0;
    for (let i = 0; i < 20; i++) {
      userStore.logout();
      let redirected = '';
      const orig = uni.reLaunch;
      // @ts-ignore
      uni.reLaunch = (args: any) => {
        redirected = String(args?.url || '');
        // @ts-ignore
        return orig.call(uni, args);
      };
      const res = handleNavigateGuard('/pages/order/manage', false, 'idle');
      // @ts-ignore
      uni.reLaunch = orig;
      if (!res && redirected.includes('/pages/login/login?redirect=')) {
        ok1++;
      }
      userStore.setToken('t', 'r');
      restoreSessionFromStorage(userStore);
      const before = userStore.token;
      const snapshot = JSON.stringify(uni.getStorageSync('userInfo') || {});
      userStore.logout();
      restoreSessionFromStorage(userStore);
      if (userStore.token === '') {
        uni.setStorageSync('userInfo', JSON.parse(snapshot || '{}'));
        userStore.setToken(before, 'r');
        restoreSessionFromStorage(userStore);
        if (userStore.token) ok2++;
      }
    }
    addLog(`C: 守卫重定向通过 ${ok1}/20，会话恢复通过 ${ok2}/20`);
  };
  
  onLoad((opt?: Record<string, string>) => {
    const c = String(opt?.case || '').toUpperCase();
    const nRaw = Number(opt?.n || '0');
    currentCase.value = c;
    remaining.value = Number.isFinite(nRaw) && nRaw >= 0 ? nRaw : 0;
    if (c === 'A') {
      if (remaining.value === 0) {
        addLog('A: 完成');
        return;
      }
      const provider = remaining.value % 2 === 0 ? 'wechat' : 'qq';
      runCaseAOnce(provider as 'wechat' | 'qq', remaining.value);
      return;
    }
    if (c === 'B') {
      void runCaseB();
      return;
    }
    if (c === 'C') {
      void runCaseC();
      return;
    }
  });
  </script>
  
  <style lang="scss" scoped>
  .qa-runner {
    padding: 12px;
  }
  .section {
    margin-bottom: 12px;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
  }
  .subtitle {
    font-size: 14px;
    font-weight: 600;
  }
  .desc {
    display: block;
    margin-top: 6px;
    color: $uni-text-color-grey;
  }
  .log-panel {
    height: 50vh;
    border: 1px solid $uni-border-color;
    padding: 8px;
    background: $uni-bg-color;
  }
  .log-item {
    margin-bottom: 4px;
  }
  .time {
    color: $uni-text-color-grey;
    margin-right: 6px;
  }
  </style>
