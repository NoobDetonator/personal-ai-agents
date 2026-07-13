// ---------- Tema ----------

function initThemeToggle() {
  const toggle = $('#themeToggle');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    document.documentElement.setAttribute('data-theme', toggle.checked ? 'light' : 'dark');
  });
}

// ---------- Init ----------

function initProjectControls() {
  $('#new-project-top')?.addEventListener('click', openCreateProjectModal);
  const sel = $('#project-switcher');
  sel?.addEventListener('change', () => {
    if (sel.value) {
      setActiveProject(sel.value);
      const scopedRoute = location.hash.startsWith('#/files') ? '#/files'
        : location.hash.startsWith('#/memory') ? '#/memory'
          : null;
      if (scopedRoute) {
        if (location.hash === scopedRoute) {
          if (scopedRoute === '#/files') void renderFiles(null);
          else void renderMemory();
        } else location.hash = scopedRoute;
      } else {
        location.hash = '#/project/' + sel.value;
      }
    }
  });
}

initThemeToggle();
initProjectControls();
refreshIcons();
loadProjects().then(() => refreshState()).then(router);
connectSse();
setInterval(refreshState, 15000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
