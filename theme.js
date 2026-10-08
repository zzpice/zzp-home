// Run before styles so a remembered appearance is applied before the first paint.
(() => {
  const key = 'zzp-home-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['light', 'dark'].includes(value) ? value : 'system';
  let mode = 'system';
  try { mode = valid(localStorage.getItem(key)); } catch {}

  function apply() {
    const theme = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    root.dataset.themeMode = mode;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#17191b' : '#faf9f6';
    root.style.backgroundColor = document.querySelector('meta[name="theme-color"]').content;
    document.querySelector('meta[name="color-scheme"]').content = theme;
    document.querySelector('link[rel="manifest"]').href = theme === 'dark' ? './manifest-dark.webmanifest' : './manifest.webmanifest';
    const select = document.getElementById('appearance');
    if (select) select.value = mode;
  }
  apply();
  system.addEventListener('change', () => { if (mode === 'system') apply(); });
  // These preferences are local to this project; another tab can change them.
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { mode = valid(event.newValue); apply(); }
  });
  window.addEventListener('pageshow', () => {
    try { mode = valid(localStorage.getItem(key)); } catch {}
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('appearance');
    apply();
    select.hidden = false;
    select.addEventListener('change', () => {
      mode = valid(select.value);
      try {
        if (mode === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, mode);
      } catch { /* The choice still works for this page when storage is blocked. */ }
      apply();
    });
  });
})();
