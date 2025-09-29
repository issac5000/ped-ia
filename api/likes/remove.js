import { HttpError, supabaseRequest } from '../../lib/anon-children.js';
import { readJsonBody, resolveUserContext, fetchLikeCount } from './_helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const body = await readJsonBody(req);
    const rawReplyId = body?.replyId ?? body?.reply_id;
    const replyId = rawReplyId != null ? String(rawReplyId).trim() : '';
    if (!replyId) {
      return res.status(400).json({ error: 'replyId required' });
    }
    const { supaUrl, headers, userId } = await resolveUserContext(req, body);
    const params = new URLSearchParams();
    params.append('reply_id', `eq.${replyId}`);
    params.append('user_id', `eq.${userId}`);
    await supabaseRequest(
      `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
      { method: 'DELETE', headers }
    );
    const count = await fetchLikeCount(supaUrl, headers, replyId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ success: true, count, liked: false });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : (err?.statusCode || 500);
    const details = err instanceof HttpError ? err.details : err?.message;
    console.error('[api/likes/remove] error', { status, details, error: err });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json({ error: err instanceof HttpError ? err.message : 'Server error', details });
  }
}
