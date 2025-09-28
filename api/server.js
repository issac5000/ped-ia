import { createClient } from '@supabase/supabase-js';
import { HttpError, fetchAnonProfile, getServiceConfig, normalizeCode } from '../lib/anon-children.js';

let cachedClient = null;
let cachedConfig = null;

function getServiceSupabaseClient() {
  const { supaUrl, serviceKey } = getServiceConfig();
  if (
    !cachedClient ||
    !cachedConfig ||
    cachedConfig.supaUrl !== supaUrl ||
    cachedConfig.serviceKey !== serviceKey
  ) {
    cachedClient = createClient(supaUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cachedConfig = { supaUrl, serviceKey };
  }
  return { supabase: cachedClient, supaUrl, serviceKey };
}

function normalizeReplyId(value) {
  if (value == null) return '';
  return String(value).trim();
}

function pickFirst(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function collectReplyIds(payload) {
  const values = [];
  const pushValue = (input) => {
    if (input == null) return;
    if (Array.isArray(input)) {
      input.forEach(pushValue);
      return;
    }
    if (typeof input === 'string') {
      input
        .split(',')
        .map((part) => part.trim())
        .forEach((part) => {
          if (part) values.push(part);
        });
      return;
    }
    values.push(String(input));
  };
  pushValue(payload.replyIds);
  pushValue(payload.replyId);
  pushValue(payload.reply_id);
  return Array.from(new Set(values.map((id) => normalizeReplyId(id)).filter(Boolean)));
}

async function resolveForumActor(req, payload, context, { required = false } = {}) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    try {
      const { data, error } = await context.supabase.auth.getUser(token);
      if (error || !data?.user?.id) {
        return { error: 'Invalid token', status: 401 };
      }
      const uid = String(data.user.id);
      return { type: 'user', userId: uid, profileId: uid };
    } catch (err) {
      console.warn('[api/server] resolveForumActor token failed', err);
      return { error: 'Invalid token', status: 401 };
    }
  }

  const code = normalizeCode(payload?.code || payload?.code_unique);
  if (code) {
    try {
      const profile = await fetchAnonProfile(context.supaUrl, context.serviceKey, code);
      const pid = profile?.id != null ? String(profile.id) : '';
      if (pid) return { type: 'anon', userId: pid, profileId: pid };
    } catch (err) {
      if (err instanceof HttpError) {
        return { error: err.message || 'Invalid code', status: err.status || 400 };
      }
      console.warn('[api/server] resolveForumActor code failed', err);
      return { error: 'Invalid code', status: 400 };
    }
  }

  if (required) {
    return { error: 'Authentication required', status: 401 };
  }

  return { type: 'guest', userId: null, profileId: null };
}

async function countLikesForReply(supabase, replyId) {
  const { count, error } = await supabase
    .from('forum_reply_likes')
    .select('reply_id', { count: 'exact', head: true })
    .eq('reply_id', replyId);
  if (error) throw error;
  return Number.isFinite(count) ? count : 0;
}

async function fetchLikeSummaries(supabase, replyIds, actorId) {
  const { data, error } = await supabase
    .from('forum_reply_likes')
    .select('reply_id,user_id')
    .in('reply_id', replyIds);
  if (error) throw error;

  const counts = Object.create(null);
  const likedMap = Object.create(null);
  const actorKey = actorId ? String(actorId) : '';

  if (Array.isArray(data)) {
    data.forEach((row) => {
      const rid = row?.reply_id != null ? String(row.reply_id) : '';
      if (!rid) return;
      counts[rid] = (counts[rid] || 0) + 1;
      if (actorKey && row?.user_id != null && String(row.user_id) === actorKey) {
        likedMap[rid] = true;
      }
    });
  }

  replyIds.forEach((rid) => {
    if (!(rid in counts)) counts[rid] = 0;
    if (actorKey && !(rid in likedMap)) likedMap[rid] = false;
  });

  return { counts, likedMap, actorKey };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = parseBody(req);
  const payload = { ...body };
  const query = req.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (payload[key] === undefined) {
      payload[key] = value;
    }
  }

  const actionRaw = payload.action ?? query.action;
  const actionValue = pickFirst(actionRaw);
  const action = typeof actionValue === 'string' ? actionValue.trim() : '';
  if (!action) {
    return res.status(400).json({ error: 'action required' });
  }

  let context;
  try {
    context = getServiceSupabaseClient();
  } catch (cfgErr) {
    const status = cfgErr instanceof HttpError ? cfgErr.status || 500 : 500;
    const message = cfgErr?.message || 'Server misconfigured';
    console.error('[api/server] service client init failed', cfgErr);
    return res.status(status).json({ error: message });
  }

  try {
    if (action === 'like' || action === 'unlike') {
      const replyId = pickFirst(payload.replyId ?? payload.reply_id) || '';
      const normalizedReplyId = normalizeReplyId(replyId);
      if (!normalizedReplyId) {
        return res.status(400).json({ error: 'replyId required' });
      }
      const actor = await resolveForumActor(req, payload, context, { required: true });
      if (actor.error) {
        return res.status(actor.status || 401).json({ error: actor.error });
      }
      if (action === 'like') {
        const { error: upsertError } = await context.supabase
          .from('forum_reply_likes')
          .upsert([{ reply_id: normalizedReplyId, user_id: actor.userId }], { onConflict: 'reply_id,user_id' });
        if (upsertError) {
          console.error('[api/server] like insert failed', upsertError);
          throw upsertError;
        }
      } else {
        const { error: deleteError } = await context.supabase
          .from('forum_reply_likes')
          .delete()
          .eq('reply_id', normalizedReplyId)
          .eq('user_id', actor.userId);
        if (deleteError) {
          console.error('[api/server] unlike delete failed', deleteError);
          throw deleteError;
        }
      }
      const count = await countLikesForReply(context.supabase, normalizedReplyId);
      return res.status(200).json({ success: true, count, liked: action === 'like' });
    }

    if (action === 'get-likes') {
      const replyIds = collectReplyIds(payload);
      if (!replyIds.length) {
        return res.status(400).json({ error: 'replyId required' });
      }
      const actor = await resolveForumActor(req, payload, context, { required: false });
      if (actor.error) {
        return res.status(actor.status || 401).json({ error: actor.error });
      }
      const { counts, likedMap, actorKey } = await fetchLikeSummaries(
        context.supabase,
        replyIds,
        actor.userId
      );
      if (replyIds.length === 1) {
        const key = replyIds[0];
        const likedValue = actorKey ? !!likedMap[key] : false;
        return res.status(200).json({ success: true, count: counts[key] ?? 0, liked: likedValue });
      }
      const likedPayload = actorKey
        ? likedMap
        : replyIds.reduce((acc, id) => {
            acc[id] = false;
            return acc;
          }, {});
      return res.status(200).json({ success: true, count: counts, liked: likedPayload });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[api/server] handler error', err);
    const status = Number(err?.status || err?.statusCode) || 500;
    const message = err?.message || 'Server error';
    const payloadError = { error: message };
    if (err?.details) payloadError.details = err.details;
    return res.status(status).json(payloadError);
  }
}
