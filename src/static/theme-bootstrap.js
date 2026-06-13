// Apply the cached light/dark mode before first paint to avoid a flash of the
// default. Used by the standalone login and guide pages (the React SPA owns its
// own theming): guide.js writes the `piledger:dark` flag when you toggle dark
// mode, and login.css / guide.css style `[data-mode="dark"]`. Run synchronously
// in <head> so the root element already has data-mode by the first paint.
try {
  if (localStorage.getItem('piledger:dark') === '1') {
    document.documentElement.setAttribute('data-mode', 'dark');
  }
} catch {}
