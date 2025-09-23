import { loadSupabaseEnv } from './supabase-env-loader.js';

let cachedClient = null;
let initPromise = null;

const DEFAULT_OPTIONS = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
};

function buildClientOptions(customOptions = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...customOptions,
    auth: {
      ...DEFAULT_OPTIONS.auth,
      ...(customOptions.auth || {}),
    },
  };
  if (merged.auth && merged.auth.storageKey == null) {
    delete merged.auth.storageKey;
  }
  if (!merged.global) {
    delete merged.global;
  }
  return merged;
}

export function getSupabaseClientSync() {
  return cachedClient;
}

export async function getSupabaseClient(options = {}) {
  if (cachedClient) return cachedClient;
  if (!initPromise) {
    initPromise = (async () => {
      const env = await loadSupabaseEnv();
      if (!env?.url || !env?.anonKey) {
        throw new Error('Missing Supabase environment variables');
      }
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      if (typeof createClient !== 'function') {
        throw new Error('Supabase SDK unavailable');
      }
      const client = createClient(env.url, env.anonKey, buildClientOptions(options));
      cachedClient = client;
      return client;
    })();
  }
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function ensureSupabaseClient(options = {}) {
  try {
    await getSupabaseClient(options);
    return true;
  } catch (err) {
    console.error('ensureSupabaseClient failed', err);
    return false;
  }
}
