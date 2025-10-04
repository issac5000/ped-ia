import { loadSupabaseEnv } from './supabase-env-loader.js';

let cachedClient = null;
let initPromise = null;
let sessionManagerInitialized = false;
let keepAliveIntervalId = null;
let reloadScheduled = false;

const KEEP_ALIVE_INTERVAL_MS = 60_000;

function scheduleReload() {
  if (reloadScheduled) return;
  reloadScheduled = true;
  if (typeof window !== 'undefined' && window?.location?.reload) {
    window.location.reload();
  }
}

function toStatusCode(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isUnauthorizedError(error) {
  if (!error) return false;
  const candidates = [
    error.status,
    error.statusCode,
    error.code,
    error?.originalError?.status,
    error?.originalError?.statusCode,
    error?.response?.status,
  ];
  for (const candidate of candidates) {
    const status = toStatusCode(candidate);
    if (status === 401 || status === 403) {
      return true;
    }
  }
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('unauthorized') || message.includes('jwt expired')) {
    return true;
  }
  return false;
}

function setupKeepAlive(client) {
  if (typeof window === 'undefined') return;
  if (keepAliveIntervalId != null) return;

  const runKeepAlive = async () => {
    try {
      const { error } = await client.from('profiles').select('id').limit(1);
      if (error) {
        if (isUnauthorizedError(error)) {
          scheduleReload();
          return;
        }
        console.error('Supabase keep-alive error', error);
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        scheduleReload();
        return;
      }
      console.error('Supabase keep-alive failed', error);
    }
  };

  keepAliveIntervalId = window.setInterval(() => {
    runKeepAlive();
  }, KEEP_ALIVE_INTERVAL_MS);

  runKeepAlive();
}

function setupSessionManagement(client) {
  if (sessionManagerInitialized) return;
  sessionManagerInitialized = true;

  let hadActiveSession = false;

  client.auth.getSession().then(({ data }) => {
    if (data?.session) {
      hadActiveSession = true;
    }
  }).catch((error) => {
    if (isUnauthorizedError(error)) {
      scheduleReload();
    } else {
      console.error('Supabase getSession failed', error);
    }
  });

  client.auth.onAuthStateChange((event, session) => {
    if (session) {
      hadActiveSession = true;
      return;
    }
    if (event === 'INITIAL_SESSION' && !hadActiveSession) {
      return;
    }
    if (event === 'TOKEN_REFRESH_FAILED' || event === 'SIGNED_OUT' || hadActiveSession) {
      scheduleReload();
    }
  });

  setupKeepAlive(client);
}

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
  if (cachedClient) {
    setupSessionManagement(cachedClient);
    return cachedClient;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const env = await loadSupabaseEnv();
      if (!env?.restUrl || !env?.anonKey) {
        throw new Error('Missing Supabase environment variables');
      }
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      if (typeof createClient !== 'function') {
        throw new Error('Supabase SDK unavailable');
      }
      const normalizedRestUrl = env.restUrl?.trim();
      const baseUrl = normalizedRestUrl?.replace(/\/?rest\/v1\/?$/i, '') || normalizedRestUrl;
      const builtOptions = buildClientOptions(options);
      const client = createClient(baseUrl, env.anonKey, {
        ...builtOptions,
        global: {
          ...(builtOptions.global || {}),
          headers: {
            ...(builtOptions.global?.headers || {}),
            apikey: env.anonKey,
          },
        },
      });
      client.restUrl = normalizedRestUrl || baseUrl;
      cachedClient = client;
      setupSessionManagement(client);
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
