/* Apply local display preferences before React paints. No credentials or network calls. */
(() => {
  const root = document.documentElement;
  let theme = 'system';
  let motion;
  try {
    const saved = localStorage.getItem('ecod-theme-v1');
    if (['system', 'light', 'dark'].includes(saved)) theme = saved;
    motion = localStorage.getItem('anthroprime-motion');
  } catch {
    /* Storage is optional. */
  }
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = root.dataset.theme;
  root.dataset.motion =
    motion === 'paused' ||
    (!motion && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      ? 'paused'
      : 'on';
})();
