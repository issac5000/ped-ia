(function(){
  const overlay = document.getElementById('loading-overlay');
  if(!overlay) return;
  const refreshBtn = overlay.querySelector('#refresh-btn');
  let done = false;
  function hide(){
    if(done) return;
    done = true;
    overlay.style.display = 'none';
  }
  // Hide as early as possible to avoid blocking scroll on heavy pages
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    hide();
  } else {
    window.addEventListener('DOMContentLoaded', hide, { once: true });
  }
  // Keep the original load hook as a fallback (no-op if already hidden)
  window.addEventListener('load', hide, { once: true });
  // Absolute safety: if something still delays, stop capturing pointer events quickly
  setTimeout(() => {
    if (!done) {
      overlay.style.pointerEvents = 'none';
    }
  }, 800);
  // Offer a manual refresh if assets take too long
  setTimeout(() => {
    if(!done){
      if(refreshBtn){
        refreshBtn.hidden = false;
        refreshBtn.addEventListener('click', () => location.reload());
      }
    }
  }, 5000);
})();

(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

  function resolveBasePath(){
    const path = window.location?.pathname || '/';
    if (path.endsWith('/')) return path;
    if (/\.[^/]+$/.test(path)) {
      return path.replace(/[^/]*$/, '');
    }
    return `${path}/`;
  }

  function normalizeLocalLink(link, basePath){
    if (!link) return;
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#') || raw.startsWith('?') || raw.startsWith('/') || schemePattern.test(raw) || raw.startsWith('//')) {
      return;
    }
    try {
      const origin = window.location?.origin || '';
      const base = `${origin}${basePath}`;
      const resolved = new URL(raw, base);
      const next = `${resolved.pathname}${resolved.search}${resolved.hash}`;
      if (next && next !== raw) {
        link.setAttribute('href', next);
      }
    } catch {}
  }

  function fixRelativeLinks(){
    const basePath = resolveBasePath();
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach(anchor => normalizeLocalLink(anchor, basePath));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixRelativeLinks, { once: true });
  } else {
    fixRelativeLinks();
  }
})();
