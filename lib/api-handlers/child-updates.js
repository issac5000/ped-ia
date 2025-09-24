import { HttpError, getServiceConfig, supabaseRequest } from '../anon-children.js';

function extractBearerToken(header) {
  if (typeof header !== 'string') return '';
  const match = header.match(/^\s*Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function limitString(value, max = 600, { allowEmpty = false } = {}) {
  if (value == null) return allowEmpty ? '' : '';
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  if (!trimmed && !allowEmpty) return '';
  return trimmed.slice(0, max);
}

function optionalString(value, max = 600) {
  if (value == null) return null;
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function fetchUserFromToken(supaUrl, serviceKey, token) {
  if (!token) throw new HttpError(401, 'Unauthorized');
  const res = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: serviceKey,
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new HttpError(res.status || 401, 'Unauthorized', text || 'Invalid token');
  }
  try {
    return JSON.parse(text || '{}');
  } catch (err) {
    throw new HttpError(500, 'Invalid auth response', err?.message || '');
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const raw = await readBody(req);
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const childId = limitString(payload.childId ?? payload.child_id ?? '', 128);
    if (!childId) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'childId required' });
    }
    const updateType = limitString(payload.updateType ?? payload.type ?? 'update', 64, { allowEmpty: true }) || 'update';
    const updateContent = typeof payload.updateContent === 'string' ? payload.updateContent : '';
    if (!updateContent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'updateContent required' });
    }
    const aiSummary = optionalString(payload.aiSummary ?? payload.ai_summary, 500);
    const aiCommentaire = optionalString(payload.aiCommentaire ?? payload.ai_commentaire, 2000);
    const token = extractBearerToken(req.headers?.authorization || req.headers?.Authorization);
    if (!token) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(401).json({ error: 'Unauthorized', details: 'Missing bearer token' });
    }
    const { supaUrl, serviceKey } = getServiceConfig();
    const user = await fetchUserFromToken(supaUrl, serviceKey, token);
    const userId = user?.id || user?.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const childRows = await supabaseRequest(
      `${supaUrl}/rest/v1/children?select=id,user_id&limit=1&id=eq.${encodeURIComponent(childId)}`,
      { headers }
    );
    const child = Array.isArray(childRows) ? childRows[0] : childRows;
    if (!child || !child.id) throw new HttpError(404, 'Child not found');
    if (String(child.user_id) !== String(userId)) throw new HttpError(403, 'Forbidden');
    const insertPayload = {
      child_id: childId,
      update_type: updateType || 'update',
      update_content: updateContent,
    };
    if (aiSummary) insertPayload.ai_summary = aiSummary;
    if (aiCommentaire) insertPayload.ai_commentaire = aiCommentaire;
    const inserted = await supabaseRequest(
      `${supaUrl}/rest/v1/child_updates`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify([insertPayload])
      }
    );
    const row = Array.isArray(inserted) ? inserted[0] : inserted || null;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ update: row });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : (err?.statusCode || 500);
    let details = '';
    if (err instanceof HttpError) {
      if (typeof err.details === 'string') details = err.details;
      else if (err.details) details = JSON.stringify(err.details);
    } else if (err?.message) {
      details = err.message;
    }
    console.error('[api/child-updates] handler error', { status, details, error: err });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json({ error: 'Unable to log child update', details: details || 'Unexpected error' });
  }
}
