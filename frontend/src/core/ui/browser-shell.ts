export const initBrowserShell = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const appWindow = window as any;
  if (appWindow.__appShellInited) {
    return;
  }
  appWindow.__appShellInited = true;

  const setVH = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const vh = viewportHeight * 0.01;
    document.documentElement.style.setProperty('--app-vh', `${vh}px`);
  };

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
      return;
    }
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
  };

  const bindContainer = () => {
    const el = document.querySelector('.page-container .content-wrapper') as HTMLElement | null;
    if (!el) {
      return;
    }
    if (boundEl !== el) {
      if (boundEl) {
        boundEl.removeEventListener('scroll', updateHints as any);
      }
      boundEl = el;
      boundEl.addEventListener('scroll', updateHints as any, { passive: true } as any);
    }
    updateHints();
  };

  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);
  window.addEventListener('pageshow', setVH);
  window.visualViewport?.addEventListener('resize', setVH);
  window.visualViewport?.addEventListener('scroll', setVH);
  window.addEventListener('resize', updateHints);
  window.addEventListener('orientationchange', updateHints);
  setTimeout(bindContainer, 0);
};
