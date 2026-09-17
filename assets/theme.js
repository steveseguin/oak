// Main Meshcast pages: default to the system, with a browser-local override.
(() => {
  const key = 'meshcast-site-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const palette = document.getElementById('site-dark-theme');
  let choice = 'system';
  function valid(value) { return ['system', 'light', 'dark'].includes(value) ? value : 'system'; }
  try { choice = valid(localStorage.getItem(key)); } catch (_) {}
  function apply() {
    const dark = choice === 'dark' || (choice === 'system' && system.matches);
    palette.media = choice === 'system' ? '(prefers-color-scheme: dark)' : dark ? 'all' : 'not all';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('.site-theme').forEach(control => { control.value = choice; });
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { choice = valid(event.newValue); apply(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.site-theme').forEach(control => {
      control.addEventListener('change', () => {
        choice = valid(control.value);
        try { localStorage.setItem(key, choice); } catch (_) {}
        apply();
      });
    });
  });
})();
