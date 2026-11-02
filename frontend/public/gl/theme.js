/* =============================================================
   GenLayer — Theme controller
   Persists a single dark/light choice across all pages (localStorage
   key "gl-theme", default dark) and wires up any [data-theme-toggle]
   buttons. To avoid a flash, also drop this tiny inline snippet in
   <head> BEFORE stylesheets:

     <script>(function(){var t=localStorage.getItem('gl-theme')||'dark';
       document.documentElement.classList.toggle('on-dark',t==='dark');})();</script>

   The `.on-dark` class lives on <html> so it covers the whole page.
   ============================================================= */
(function () {
  var KEY = 'gl-theme';
  function get() { return localStorage.getItem(KEY) || 'dark'; }
  function apply(t) { document.documentElement.classList.toggle('on-dark', t === 'dark'); }
  function set(t) { localStorage.setItem(KEY, t); apply(t); }

  apply(get()); // ensure correct even if inline head snippet was omitted

  function wire() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      if (btn.__glWired) return;
      btn.__glWired = true;
      btn.addEventListener('click', function () {
        set(get() === 'dark' ? 'light' : 'dark');
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  // keep tabs in sync
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(get()); });

  window.GLTheme = { get: get, set: set, toggle: function () { set(get() === 'dark' ? 'light' : 'dark'); } };
})();
