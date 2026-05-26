'use strict';

function toggleGuideTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-mode') === 'dark';
  if (isDark) root.removeAttribute('data-mode');
  else        root.setAttribute('data-mode', 'dark');
  try { localStorage.setItem('piledger:dark', isDark ? '0' : '1'); } catch {}
}

function toggleGuideSidebar() {
  document.getElementById('guide-sidebar').classList.toggle('open');
}

async function loadDoc(slug) {
  if (!slug) return;

  document.querySelectorAll('.guide-nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.slug === slug)
  );

  document.getElementById('guide-sidebar').classList.remove('open');
  history.replaceState(null, '', '/guide#' + slug);

  const content = document.getElementById('guide-content');
  content.innerHTML = '<div class="guide-loading">Loading…</div>';

  try {
    const res = await fetch('/api/docs/' + encodeURIComponent(slug));
    if (!res.ok) throw new Error('Not found');
    const md = await res.text();
    content.innerHTML = marked.parse(md);
    window.scrollTo(0, 0);
  } catch {
    content.innerHTML = '<div class="guide-loading">Could not load document.</div>';
  }
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const link = document.getElementById('guide-back-link');
      if (link) {
        link.href = '/';
        link.textContent = '← Back to app';
      }
    }
  } catch {}
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const fn = t.dataset.action;
  const arg = t.dataset.arg;
  if (fn === 'loadDoc')            loadDoc(arg);
  if (fn === 'toggleGuideTheme')   toggleGuideTheme();
  if (fn === 'toggleGuideSidebar') toggleGuideSidebar();
});

(function () {
  const hash = location.hash.replace('#', '');
  loadDoc(hash || 'getting-started');
  checkAuth();
})();
