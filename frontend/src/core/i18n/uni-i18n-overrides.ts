export function applyUniI18nOverrides() {
  const set = (locale: string, cancel: string, done: string) => {
    const u: any = typeof uni !== 'undefined' ? (uni as any) : null;
    if (!u || typeof u.setLocaleMessages !== 'function') return false;
    try {
      u.setLocaleMessages({
        locale,
        messages: {
          uni: {
            picker: { cancel, done },
          },
        },
      });
    } catch {}

    try {
      u.setLocaleMessages({
        locale,
        messages: {
          'uni.picker.cancel': cancel,
          'uni.picker.done': done,
        },
      });
    } catch {}
    return true;
  };

  const applyAll = () => {
    const ok =
      set('zh-CN', '取消', '完成') ||
      set('zh_CN', '取消', '完成') ||
      set('zh', '取消', '完成') ||
      set('zh-Hans', '取消', '完成') ||
      set('zh-hans', '取消', '完成') ||
      set('zh-Hans-CN', '取消', '完成') ||
      set('en-US', 'Cancel', 'Done') ||
      set('en_US', 'Cancel', 'Done') ||
      set('en', 'Cancel', 'Done');
    return ok;
  };

  const applied = applyAll();

  if (!applied && typeof window !== 'undefined') {
    let remaining = 10;
    const tick = () => {
      if (applyAll()) return;
      remaining -= 1;
      if (remaining <= 0) return;
      setTimeout(tick, 250);
    };
    setTimeout(tick, 0);
  }
}
