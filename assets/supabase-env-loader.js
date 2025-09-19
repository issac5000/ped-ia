let cache = null;
let loadingPromise = null;

function normalize(raw = {}) {
  const url = raw.url || raw.SUPABASE_URL || '';
  const anonKey = raw.anonKey || raw.SUPABASE_ANON_KEY || '';
  return { url, anonKey };
}

export function setSupabaseEnv(url, anonKey) {
  cache = normalize({ url, anonKey });
  return cache;
}

export async function loadSupabaseEnv() {
  if (cache) return cache;
  if (typeof window !== 'undefined' && window.__SUPABASE_ENV__) {
    cache = normalize(window.__SUPABASE_ENV__);
    return cache;
  }
  if (!loadingPromise) {
    const src = '/assets/supabase-env.json';
    loadingPromise = fetch(src, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : {})
      .catch(() => ({}))
      .then(data => {
        cache = normalize(data);
        if (typeof window !== 'undefined') {
          window.__SUPABASE_ENV__ = cache;
        }
        return cache;
      });
  }
  return loadingPromise;
}
