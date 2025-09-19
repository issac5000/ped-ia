import { getServiceConfig, supabaseRequest } from '../lib/anon-children.js';

function buildServiceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

function sanitizeLimit(limit, fallback = 5) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), 25);
}

export async function insertImageJob(record) {
  const { supaUrl, serviceKey } = getServiceConfig();
  const headers = {
    ...buildServiceHeaders(serviceKey),
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const result = await supabaseRequest(`${supaUrl}/rest/v1/image_jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(record),
  });
  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return result ?? null;
}

export async function fetchPendingImageJobs(limit = 5) {
  const { supaUrl, serviceKey } = getServiceConfig();
  const headers = buildServiceHeaders(serviceKey);
  const safeLimit = sanitizeLimit(limit);
  const url = `${supaUrl}/rest/v1/image_jobs?status=eq.pending&order=created_at.asc&limit=${safeLimit}`;
  const rows = await supabaseRequest(url, { headers });
  if (Array.isArray(rows)) return rows;
  if (rows == null) return [];
  return [rows];
}

export async function updateImageJob(id, patch) {
  if (!id) throw new Error('Job id required');
  const { supaUrl, serviceKey } = getServiceConfig();
  const headers = {
    ...buildServiceHeaders(serviceKey),
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  return supabaseRequest(`${supaUrl}/rest/v1/image_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch ?? {}),
  });
}

export async function fetchImageJobById(id) {
  if (!id) throw new Error('Job id required');
  const { supaUrl, serviceKey } = getServiceConfig();
  const headers = buildServiceHeaders(serviceKey);
  const url = `${supaUrl}/rest/v1/image_jobs?id=eq.${encodeURIComponent(id)}&limit=1`;
  const rows = await supabaseRequest(url, { headers });
  if (Array.isArray(rows)) {
    return rows[0] ?? null;
  }
  return rows ?? null;
}

export function parseJobPayload(rawPrompt) {
  if (typeof rawPrompt !== 'string') {
    return { prompt: '', child: null };
  }
  const trimmed = rawPrompt.trim();
  if (!trimmed) return { prompt: '', child: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : trimmed;
      const child = Object.prototype.hasOwnProperty.call(parsed, 'child') ? parsed.child : null;
      return { prompt, child };
    }
    if (typeof parsed === 'string') {
      return { prompt: parsed, child: null };
    }
  } catch {}
  return { prompt: trimmed, child: null };
}
