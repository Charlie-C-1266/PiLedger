// Apply cached theme/mode before paint to avoid a flash of the default.
// The server-stored prefs at /api/prefs are fetched after boot and override
// these if they differ. Run synchronously in <head> so the root element
// already has data-theme/data-mode by the time the first paint happens.
try {
  const t = localStorage.getItem('piledger:theme');
  const d = localStorage.getItem('piledger:dark') === '1';
  if (t) document.documentElement.setAttribute('data-theme', t);
  if (d) document.documentElement.setAttribute('data-mode', 'dark');
} catch {}
