let cache = null;
let loadingPromise = null;

function normalize(raw = {}) {
  const url = raw.url || raw.SUPABASE_URL || '';
  const anonKey = raw.anonKey || raw.SUPABASE_ANON_KEY || '';
  return { url, anonKey };
}

function remember(env) {
  cache = normalize(env);
  if (typeof window !== 'undefined') {
    window.__SUPABASE_ENV__ = cache;
  }
  return cache;
}

export function setSupabaseEnv(url, anonKey) {
  return remember({ url, anonKey });
}

async function fetchEnvCandidate(src) {
  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res?.ok) return null;
    const data = await res.json().catch(() => ({}));
    const payload = data && typeof data === 'object' && data.success ? (data.data || {}) : data;
    return normalize(payload);
  } catch {
    return null;
  }
}

export async function loadSupabaseEnv() {
  if (cache && cache.url && cache.anonKey) return cache;
  if (typeof window !== 'undefined' && window.__SUPABASE_ENV__) {
    return remember(window.__SUPABASE_ENV__);
  }
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const sources = ['https://myrwcjurblksypvekuzb.supabase.co/functions/v1/env', '/assets/supabase-env.json'];
      for (const src of sources) {
        const candidate = await fetchEnvCandidate(src);
        if (!candidate) continue;
        remember(candidate);
        if (candidate.url && candidate.anonKey) break;
      }
      if (!cache) remember({});
      return cache;
    })();
  }
  return loadingPromise.then(env => {
    if (!cache && env) remember(env);
    return cache || env || remember({});
  });
}
