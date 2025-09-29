// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.ts';

export function extractBearerToken(header) {
  if (typeof header !== 'string') return '';
  const match = header.match(/^\s*Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

let cachedAdminClient = null;
let cachedConfigKey = '';

function getSupabaseAdminClient(supaUrl, serviceKey) {
  const cacheKey = `${supaUrl}::${serviceKey}`;
  if (!cachedAdminClient || cachedConfigKey !== cacheKey) {
    cachedAdminClient = createClient(supaUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: { Authorization: `Bearer ${serviceKey}` },
      },
    });
    cachedConfigKey = cacheKey;
  }
  return cachedAdminClient;
}

export async function resolveUserContext(req) {
  const { supaUrl, serviceKey } = getServiceConfig();
  if (!supaUrl || !serviceKey) {
    console.log('[resolveUserContext] missing Supabase configuration');
    return { error: { status: 500, message: 'Server misconfigured' } };
  }

  const supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const supabaseAdmin = getSupabaseAdminClient(supaUrl, serviceKey);

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const bearerToken = extractBearerToken(authHeader);

  let payload = {};
  try {
    payload = await req.clone().json();
  } catch (_err) {
    payload = {};
  }
  const tokenFromBody = typeof payload?.token === 'string' ? payload.token.trim() : '';
  const token = bearerToken || tokenFromBody;

  console.log('[resolveUserContext] start', { hasBearer: !!bearerToken, hasBodyToken: !!tokenFromBody });

  if (token) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) {
      console.log('[resolveUserContext] invalid token', { error });
      return { error: { status: 401, message: 'Unauthorized' } };
    }
    console.log('[resolveUserContext] resolved via token', { userId: data.user.id });
    return {
      supaUrl,
      headers: supabaseHeaders,
      userId: String(data.user.id),
      mode: 'token',
      anon: false,
      token,
    };
  }

  const anonCodeRaw = typeof payload?.anonCode === 'string' ? payload.anonCode.trim() : '';
  if (anonCodeRaw) {
    const anonCode = normalizeCode(anonCodeRaw);
    console.log('[resolveUserContext] anonCode supplied', { anonCode });
    if (!anonCode) {
      console.log('[resolveUserContext] anonCode normalization failed');
      return { error: { status: 400, message: 'Invalid anonCode' } };
    }
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('code_unique', anonCode)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.log('[resolveUserContext] anonCode lookup error', { error });
      return { error: { status: error.status ?? 500, message: 'Invalid anonCode' } };
    }
    if (!data?.id) {
      console.log('[resolveUserContext] anonCode not found');
      return { error: { status: 400, message: 'Invalid anonCode' } };
    }
    console.log('[resolveUserContext] resolved via anonCode', { profileId: data.id });
    return {
      supaUrl,
      headers: supabaseHeaders,
      userId: String(data.id),
      mode: 'anonCode',
      anon: true,
    };
  }

  const code = normalizeCode(payload?.code || payload?.code_unique);
  if (code) {
    console.log('[resolveUserContext] fallback code supplied', { code });
    try {
      const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
      const profileId = profile?.id;
      if (!profileId) {
        console.log('[resolveUserContext] fallback code unauthorized');
        return { error: { status: 401, message: 'Unauthorized' } };
      }
      console.log('[resolveUserContext] resolved via fallback code', { profileId });
      return {
        supaUrl,
        headers: supabaseHeaders,
        userId: String(profileId),
        mode: 'code',
        anon: true,
      };
    } catch (err) {
      const status = err instanceof HttpError ? err.status ?? 500 : 500;
      const message = err instanceof HttpError ? err.message : 'Unauthorized';
      console.log('[resolveUserContext] fallback code error', { status, message, error: err });
      return { error: { status, message } };
    }
  }

  console.log('[resolveUserContext] missing credentials');
  return { error: { status: 400, message: 'code or token required' } };
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
