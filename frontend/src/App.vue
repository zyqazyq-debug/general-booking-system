<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { useUserStore } from '@/stores/user';
import { nextTick } from 'vue';

onLaunch(() => {
  console.log("App Launch");
  const userStore = useUserStore();
  
  // Check auth
  const token = uni.getStorageSync('token');
  const user = uni.getStorageSync('userInfo');
  
  if (token && user) {
      userStore.token = token;
      userStore.userInfo = JSON.parse(user);
  } else {
      // Allow public pages like login/register/share
      // But for protected pages, we should redirect.
      // Since onLaunch happens once, we might rely on page hooks or simple logic:
      // If we are not on a whitelist page, redirect.
      // But uniapp routing is tricky in onLaunch.
      // Best practice: Let pages handle auth or use a global interceptor if possible.
      // For now, let's just ensure we don't start at index if not logged in, but manifest sets start page.
      // We can redirect in onShow if needed.
  }

  if (typeof window !== 'undefined') {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--app-vh', `${vh}px`);
    };
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    window.addEventListener('pageshow', setVH);

    const ensureScrollHints = () => {
      let el = document.getElementById('scroll-hints');
      if (!el) {
        el = document.createElement('div');
        el.id = 'scroll-hints';
        el.className = 'scroll-hints';
        document.body.appendChild(el);
      }
      return el as HTMLDivElement;
    };

    let boundEl: HTMLElement | null = null;
    const updateHints = () => {
      const container = document.querySelector('.page-container .content-wrapper') as HTMLElement | null;
      const hint = ensureScrollHints();
      if (!container) {
        hint.style.display = 'none';
        return;
      }
      const max = container.scrollHeight - container.clientHeight;
      const st = container.scrollTop;
      const showUp = st > 2;
      const showDown = st < max - 2;
      if (!showUp && !showDown) {
        hint.style.display = 'none';
      } else {
        hint.style.display = 'flex';
        hint.innerHTML = '';
        if (showUp) {
          const up = document.createElement('div');
          up.className = 'arrow up';
          up.textContent = '↑';
          hint.appendChild(up);
        }
        if (showDown) {
          const down = document.createElement('div');
          down.className = 'arrow down';
          down.textContent = '↓';
          hint.appendChild(down);
        }
      }
    };

    const bindContainer = () => {
      const el = document.querySelector('.page-container .content-wrapper') as HTMLElement | null;
      if (!el) return;
      if (boundEl !== el) {
        if (boundEl) boundEl.removeEventListener('scroll', updateHints as any);
        boundEl = el;
        boundEl.addEventListener('scroll', updateHints as any, { passive: true } as any);
      }
      updateHints();
    };

    window.addEventListener('resize', updateHints);
    window.addEventListener('orientationchange', updateHints);
    setTimeout(bindContainer, 0);
  }
});

onShow(() => {
  console.log("App Show");
  const userStore = useUserStore();
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  const route = currentPage?.route || '';
  
  const whiteList = [
      'pages/login/login', 
      'pages/login/register', 
      'pages/share/view',
      'pages/booking/detail', // Allow detail page for anonymous view
      'pages/admin/login'
  ];
  
  // Simple guard
  // We check route first to avoid unnecessary redirect loop
  if (!whiteList.includes(route)) {
      const token = uni.getStorageSync('token');
      if (!token) {
          // If no token and not in whitelist, redirect to login
          // Use reLaunch to clear stack
          uni.reLaunch({ url: '/pages/login/login' });
      } else {
          // If token exists but not in store (e.g. page refresh), restore it
          if (!userStore.token) {
              userStore.token = token;
              const user = uni.getStorageSync('user');
              if (user) {
                  userStore.userInfo = JSON.parse(user);
              }
          }
      }
  }
});

onHide(() => {
  console.log("App Hide");
});
</script>
<style lang="scss">
@use "sass:color";
/* Global Styles - Bookly Pro Inspired */
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}
page {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background-color: $uni-bg-color-grey;
    color: $uni-text-color;
    font-size: 14px;
    line-height: 1.5;
}
.container {
    padding: $uni-spacing-base;
}

/* Card Styles */
.card {
    background-color: #fff;
    border-radius: $uni-border-radius-lg;
    box-shadow: $uni-shadow-sm;
    margin-bottom: $uni-spacing-base;
    overflow: hidden;
    transition: box-shadow 0.3s ease;
    border: 1px solid $uni-border-color;
}
.card:active {
    box-shadow: $uni-shadow-base;
}
.card-header {
    padding: $uni-spacing-base;
    border-bottom: 1px solid $uni-border-color;
    font-weight: 600;
    font-size: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: #fcfcfc;
}
.card-body {
    padding: $uni-spacing-base;
}

/* Utilities */
.p-0 { padding: 0 !important; }
.p-3 { padding: $uni-spacing-base !important; }
.mb-3 { margin-bottom: $uni-spacing-base !important; }
.mb-4 { margin-bottom: $uni-spacing-lg !important; }
.mt-2 { margin-top: $uni-spacing-sm !important; }
.text-center { text-align: center; }
.text-primary { color: $uni-color-primary !important; }
.text-success { color: $uni-color-success !important; }
.text-muted { color: $uni-text-color-grey !important; }
.fw-bold { font-weight: 600 !important; }

/* Typography */
h2 { font-size: 24px; font-weight: 700; margin: 8px 0; color: #1e293b; }
h4 { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #334155; }
h5 { font-size: 16px; font-weight: 600; margin-bottom: 4px; color: #475569; }
h6 { font-size: 14px; font-weight: 600; margin-bottom: 4px; color: #1e293b; }

/* Grid */
.row { display: flex; flex-wrap: wrap; margin: 0 -8px; }
.col-6 { width: 50%; padding: 0 8px; }
.col-12 { width: 100%; padding: 0 8px; }

/* List Item */
.list-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: $uni-spacing-base;
    border-bottom: 1px solid $uni-border-color;
    background: #fff;
    transition: background-color 0.2s;
}
.list-item:active { background-color: $uni-bg-color-hover; }
.list-item:last-child { border-bottom: none; }
.list-item .left { flex: 1; }
.list-item .left p { font-size: 13px; color: $uni-text-color-grey; margin-top: 4px; }
.source-tag {
    display: inline-block;
    background-color: rgba(78, 151, 252, 0.1);
    color: $uni-color-primary;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    margin-left: 6px;
    font-weight: 500;
}

/* Forms */
.form-control {
    width: 100%;
    height: 48px;
    line-height: 48px;
    border-radius: $uni-border-radius-base;
    padding: 0 16px;
    font-size: 15px;
    border: 1px solid $uni-border-color;
    background: #fff;
    margin-bottom: 12px;
    transition: border-color 0.2s;
}
.form-control:focus {
    border-color: $uni-color-primary;
}
.form-label { display: block; margin-bottom: 8px; font-weight: 500; color: #334155; font-size: 14px; }

/* Buttons */
.btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    border-radius: $uni-border-radius-base;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    border: 1px solid transparent;
    background-color: #fff;
    color: #334155;
    margin-bottom: 12px;
    box-shadow: $uni-shadow-sm;
    transition: all 0.2s ease;
}
.btn:active { transform: translateY(1px); box-shadow: none; }
.btn-primary {
    background-color: $uni-color-primary !important;
    color: #ffffff !important;
    border-color: $uni-color-primary !important;
    box-shadow: 0 4px 6px -1px rgba(78, 151, 252, 0.3);
}
.btn-primary:active {
    background-color: color.adjust($uni-color-primary, $lightness: -5%) !important;
}
.btn-outline-primary {
    background-color: transparent;
    color: $uni-color-primary;
    border-color: $uni-color-primary;
    box-shadow: none;
}
.btn-sm {
    height: 32px;
    padding: 0 12px;
    font-size: 13px;
    width: auto;
    display: inline-flex;
    margin: 0 4px;
}

/* Badges */
.badge {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    display: inline-block;
}
.bg-success { background-color: $uni-color-success; }
.bg-secondary { background-color: #94a3b8; }
.bg-primary { background-color: $uni-color-primary; }
.bg-danger { background-color: $uni-color-error; }
.bg-warning { background-color: $uni-color-warning; color: #334155; }

/* Bottom Tab */
.bottom-tab {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-top: 1px solid $uni-border-color;
    display: flex;
    z-index: 99;
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: 0 -4px 6px -1px rgba(0,0,0,0.02);
}
.tab-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: $uni-text-color-grey;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
}
.tab-item.active { color: $uni-color-primary; }
.tab-icon { font-size: 22px; margin-bottom: 2px; }

/* Filter Bar */
.filter-bar {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
}

.page-container {
    height: calc(var(--app-vh, 1vh) * 100);
    background-color: #f1f5f9;
    overflow: hidden;
    --top-offset: 56px;
    --bottom-offset: 0px;
    position: relative;
}
.page-container.no-top-nav { --top-offset: 0px; }
.top-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    background-color: #fff;
    border-bottom: 1px solid $uni-border-color;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99;
    padding: 0 16px;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
.page-title {
    font-size: 17px;
    font-weight: 600;
    color: #1e293b;
}
.role-selector {
    position: absolute;
    right: 16px;
    font-size: 13px;
    color: #475569;
    display: flex;
    align-items: center;
    background: #f8fafc;
    padding: 6px 10px;
    border-radius: 20px;
    border: 1px solid $uni-border-color;
}
.role-name {
    font-weight: 600;
    color: $uni-color-primary;
    margin-right: 4px;
}
.arrow { font-size: 10px; color: #94a3b8; }
.role-menu {
    position: absolute;
    top: 120%;
    right: 0;
    background: #fff;
    border: 1px solid $uni-border-color;
    border-radius: 12px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    width: 140px;
    z-index: 100;
    padding: 6px;
}
.role-menu-item {
    padding: 10px 12px;
    text-align: left;
    color: #334155;
    font-size: 14px;
    border-radius: 8px;
    font-weight: 500;
}
.role-menu-item:active {
    background-color: #f1f5f9;
    color: $uni-color-primary;
}
.page-container .content-wrapper {
    position: absolute;
    top: var(--top-offset);
    bottom: var(--bottom-offset);
    left: 0;
    right: 0;
    overflow-y: auto;
    padding: 8px 16px 16px 16px;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.page-container .content-wrapper::-webkit-scrollbar { width: 0; height: 0; }
.page-container.has-bottom-tab { --bottom-offset: calc(60px + env(safe-area-inset-bottom)); }
.center-content {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 80vh;
}

.scroll-hints {
    position: fixed;
    right: 10px;
    bottom: 80px;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 6px;
    background: rgba(0,0,0,0.25);
    color: #fff;
    backdrop-filter: blur(6px);
    border-radius: 14px;
    z-index: 9999;
    pointer-events: none;
}
.scroll-hints .arrow { font-size: 12px; line-height: 1; opacity: 0.9; }
</style>
