import { loadSupabaseEnv } from './supabase-env-loader.js';

const DEFAULT_EDGE_FUNCTION_BASE = '/api/edge';
let lastEnv = null;

function rememberEnv(env) {
  if (env && typeof env === 'object') {
    lastEnv = env;
  }
  return lastEnv || {};
}

export function resolveEdgeFunctionBase(explicitEnv) {
  const env = explicitEnv || (typeof window !== 'undefined' ? window.__SUPABASE_ENV__ : null) || lastEnv || {};
  const rawBase = typeof env.functionsUrl === 'string' ? env.functionsUrl.trim() : '';
  if (rawBase) {
    return rawBase.replace(/\/+$/, '');
  }
  return DEFAULT_EDGE_FUNCTION_BASE;
}

async function ensureEnv() {
  if (typeof window !== 'undefined' && window.__SUPABASE_ENV__) {
    return rememberEnv(window.__SUPABASE_ENV__);
  }
  const env = await loadSupabaseEnv();
  return rememberEnv(env);
}

export async function callEdgeFunction(name, { method = 'POST', body, headers = {}, getAuthToken, signal } = {}) {
  const env = await ensureEnv();
  const baseUrl = resolveEdgeFunctionBase(env);
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (env?.anonKey) {
    finalHeaders.apikey = env.anonKey;
  }
  if (body === undefined) {
    delete finalHeaders['Content-Type'];
  }
  let authValue = env?.anonKey || '';
  if (typeof getAuthToken === 'function') {
    try {
      const token = await getAuthToken();
      if (token) {
        authValue = token;
      }
    } catch (err) {
      console.warn('callEdgeFunction: getAuthToken failed', err);
    }
  }
  if (authValue) {
    finalHeaders.Authorization = `Bearer ${authValue}`;
  }
  const requestInit = {
    method,
    headers: finalHeaders,
    signal,
  };
  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }
  const url = `${baseUrl}/${name}`;
  let response;
  try {
    response = await fetch(url, requestInit);
  } catch (err) {
    const networkError = new Error('Connexion au service Supabase impossible.');
    networkError.cause = err;
    throw networkError;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const rawBody = await response.text().catch(() => '');
    const err = new Error('Mauvaise URL de fonctions (HTML reçu)');
    err.status = response.status;
    err.statusText = response.statusText;
    err.body = rawBody;
    throw err;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (typeof payload?.error === 'string' && payload.error.trim())
      || (typeof payload?.message === 'string' && payload.message.trim())
      || '';
    const err = new Error(message || 'Service indisponible');
    err.status = response.status;
    err.statusText = response.statusText;
    err.details = payload?.details ?? null;
    throw err;
  }
  if (payload?.success === false) {
    const err = new Error(payload?.error || 'Service indisponible');
    err.details = payload?.details ?? null;
    err.status = response.status;
    throw err;
  }
  return payload?.data ?? payload ?? null;
}
