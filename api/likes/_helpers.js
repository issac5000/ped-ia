import { HttpError, getServiceConfig, normalizeCode, fetchAnonProfile, supabaseRequest } from '../../lib/anon-children.js';

export function extractBearerToken(header) {
  if (typeof header !== 'string') return '';
  const match = header.match(/^\s*Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e6) {
      req.destroy();
      throw new HttpError(413, 'Payload too large');
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
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
    return text ? JSON.parse(text) : {};
  } catch (err) {
    throw new HttpError(500, 'Invalid auth response', err?.message || '');
  }
}

export async function resolveUserContext(req, body = {}) {
  const { supaUrl, serviceKey } = getServiceConfig();
  const supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const bearerToken = extractBearerToken(authHeader);
  const tokenFromBody = typeof body?.token === 'string' ? body.token.trim() : '';
  const token = bearerToken || tokenFromBody;
  if (token) {
    const user = await fetchUserFromToken(supaUrl, serviceKey, token);
    const userId = user?.id || user?.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    return {
      supaUrl,
      headers: supabaseHeaders,
      userId: String(userId),
      mode: 'token',
    };
  }
  const code = normalizeCode(body?.code || body?.code_unique);
  if (code) {
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = profile?.id;
    if (!profileId) throw new HttpError(401, 'Unauthorized');
    return {
      supaUrl,
      headers: supabaseHeaders,
      userId: String(profileId),
      mode: 'code',
      profile,
    };
  }
  throw new HttpError(401, 'Unauthorized');
}

export async function fetchLikeCount(supaUrl, headers, replyId) {
  const params = new URLSearchParams({ select: 'reply_id' });
  params.append('reply_id', `eq.${replyId}`);
  const rows = await supabaseRequest(
    `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
    { headers }
  );
  return Array.isArray(rows) ? rows.length : 0;
}
