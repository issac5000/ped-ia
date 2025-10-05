let loadPromise = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[data-react-shim="${src}"]`);
    if (existing) {
      if (existing.dataset.ready === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.crossOrigin = 'anonymous';
    script.dataset.reactShim = src;
    script.addEventListener('load', () => {
      script.dataset.ready = '1';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

export async function ensureReactGlobals() {
  if (typeof window === 'undefined') return;
  if (window.React && window.ReactDOM) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        if (!window.React) {
          await loadScriptOnce('https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js');
        }
        if (!window.ReactDOM) {
          await loadScriptOnce('https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js');
        }
      } catch (err) {
        console.warn('React shim failed to load React libraries', err);
        loadPromise = null;
        throw err;
      }
    })();
  }
  return loadPromise;
}
