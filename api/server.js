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

async function ensureReplyExists(supabase, replyId) {
  const { count, error } = await supabase
    .from('forum_replies')
    .select('id', { head: true, count: 'exact' })
    .eq('id', replyId);
  if (error) throw error;
  return Number.isFinite(count) && count > 0;
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
    const supabase = context.supabase;
    const replyIdRaw = pickFirst(payload.replyId ?? payload.reply_id);
    const normalizedReplyId = normalizeReplyId(replyIdRaw);

    switch (action) {
      case 'like': {
        if (!normalizedReplyId) {
          return res.status(400).json({ error: 'replyId required' });
        }
        const actor = await resolveForumActor(req, payload, context, { required: true });
        if (actor.error) {
          return res.status(actor.status || 401).json({ error: actor.error });
        }
        const exists = await ensureReplyExists(supabase, normalizedReplyId);
        if (!exists) {
          return res.status(404).json({ error: 'Reply not found' });
        }
        const { data: existingRows, error: selectError } = await supabase
          .from('forum_reply_likes')
          .select('reply_id')
          .eq('reply_id', normalizedReplyId)
          .eq('user_id', actor.userId)
          .limit(1);
        if (selectError) {
          console.error('[api/server] like select failed', selectError);
          throw selectError;
        }
        const alreadyLiked = Array.isArray(existingRows) && existingRows.length > 0;
        if (!alreadyLiked) {
          const { error: insertError } = await supabase
            .from('forum_reply_likes')
            .insert([{ reply_id: normalizedReplyId, user_id: actor.userId }]);
          if (insertError) {
            console.error('[api/server] like insert failed', insertError);
            throw insertError;
          }
        }
        const count = await countLikesForReply(supabase, normalizedReplyId);
        return res.status(200).json({ success: true, count, liked: true });
      }
      case 'unlike': {
        if (!normalizedReplyId) {
          return res.status(400).json({ error: 'replyId required' });
        }
        const actor = await resolveForumActor(req, payload, context, { required: true });
        if (actor.error) {
          return res.status(actor.status || 401).json({ error: actor.error });
        }
        const exists = await ensureReplyExists(supabase, normalizedReplyId);
        if (!exists) {
          return res.status(404).json({ error: 'Reply not found' });
        }
        const { error: deleteError } = await supabase
          .from('forum_reply_likes')
          .delete()
          .eq('reply_id', normalizedReplyId)
          .eq('user_id', actor.userId);
        if (deleteError) {
          console.error('[api/server] unlike delete failed', deleteError);
          throw deleteError;
        }
        const count = await countLikesForReply(supabase, normalizedReplyId);
        return res.status(200).json({ success: true, count, liked: false });
      }
      case 'get-likes': {
        if (!normalizedReplyId) {
          return res.status(400).json({ error: 'replyId required' });
        }
        const actor = await resolveForumActor(req, payload, context, { required: false });
        if (actor.error) {
          return res.status(actor.status || 401).json({ error: actor.error });
        }
        const exists = await ensureReplyExists(supabase, normalizedReplyId);
        if (!exists) {
          return res.status(404).json({ error: 'Reply not found' });
        }
        const count = await countLikesForReply(supabase, normalizedReplyId);
        let liked = false;
        if (actor.userId) {
          const { data: likedRows, error: likedError } = await supabase
            .from('forum_reply_likes')
            .select('reply_id')
            .eq('reply_id', normalizedReplyId)
            .eq('user_id', actor.userId)
            .limit(1);
          if (likedError) {
            console.error('[api/server] liked select failed', likedError);
            throw likedError;
          }
          liked = Array.isArray(likedRows) && likedRows.length > 0;
        }
        return res.status(200).json({ success: true, count, liked });
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[api/server] handler error', err);
    const status = Number(err?.status || err?.statusCode) || 500;
    const message = err?.message || 'Server error';
    const payloadError = { error: message };
    if (err?.details) payloadError.details = err.details;
    return res.status(status).json(payloadError);
  }
}
