import { HttpError, supabaseRequest } from '../../lib/anon-children.js';
import { readJsonBody, resolveUserContext } from './_helpers.js';

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
    const replyIdsRaw = Array.isArray(body?.replyIds) ? body.replyIds : Array.isArray(body?.reply_ids) ? body.reply_ids : [];
    const replyIds = replyIdsRaw
      .map((value) => (value != null ? String(value).trim() : ''))
      .filter(Boolean);
    if (!replyIds.length) {
      return res.status(400).json({ error: 'replyIds required' });
    }
    if (replyIds.length > 200) {
      return res.status(400).json({ error: 'Too many replyIds' });
    }

    const { supaUrl, headers, userId } = await resolveUserContext(req, body);
    const uniqueIds = Array.from(new Set(replyIds));
    const safeList = uniqueIds
      .map((id) => `"${id.replace(/"/g, '""')}"`)
      .join(',');
    const params = new URLSearchParams({ select: 'reply_id,user_id' });
    params.append('reply_id', `in.(${safeList})`);
    const rows = await supabaseRequest(
      `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
      { headers }
    );
    const likes = Array.isArray(rows) ? rows : [];
    const result = {};
    uniqueIds.forEach((id) => {
      result[id] = { count: 0, liked: false };
    });
    likes.forEach((row) => {
      const replyId = row?.reply_id != null ? String(row.reply_id) : '';
      if (!replyId || !(replyId in result)) return;
      result[replyId].count += 1;
      if (row?.user_id != null && String(row.user_id) === userId) {
        result[replyId].liked = true;
      }
    });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : (err?.statusCode || 500);
    const details = err instanceof HttpError ? err.details : err?.message;
    console.error('[api/likes/get] error', { status, details, error: err });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json({ error: err instanceof HttpError ? err.message : 'Server error', details });
  }
}
