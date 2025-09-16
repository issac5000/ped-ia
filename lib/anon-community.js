import { randomUUID } from 'crypto';
import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.js';

function sanitizeString(raw, max = 500) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  return str.slice(0, max);
}

function sanitizeTitle(raw) {
  const title = sanitizeString(raw, 160);
  if (!title) return '';
  // Collapse consecutive whitespace while preserving basic spacing
  return title.replace(/\s+/g, ' ').trim();
}

function sanitizeContent(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  // Limit to a reasonable size to avoid abuse
  return str.slice(0, 5000);
}

function sanitizeId(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  return str;
}

function normalizeId(value) {
  return sanitizeId(value) || '';
}

function buildInFilter(values) {
  const safeValues = Array.from(values || [])
    .map((v) => sanitizeId(v))
    .filter(Boolean)
    .map((v) => `"${v.replace(/"/g, '""')}"`);
  if (!safeValues.length) return '';
  return `in.(${safeValues.join(',')})`;
}

export async function processAnonCommunityRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'code required');

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = String(profile.id);

    if (action === 'list') {
      const topicsData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_topics?select=id,user_id,title,content,created_at&order=created_at.desc&limit=200`,
        { headers }
      );
      const topics = Array.isArray(topicsData) ? topicsData : [];
      const topicIds = topics.map((t) => t?.id).filter(Boolean);

      let replies = [];
      if (topicIds.length) {
        const repliesParams = new URLSearchParams({
          select: 'id,topic_id,user_id,content,created_at',
          order: 'created_at.asc',
        });
        const inFilter = buildInFilter(topicIds);
        if (inFilter) repliesParams.append('topic_id', inFilter);
        const repliesData = await supabaseRequest(
          `${supaUrl}/rest/v1/forum_replies?${repliesParams.toString()}`,
          { headers }
        );
        replies = Array.isArray(repliesData) ? repliesData : [];
      }

      const userIds = new Set();
      topics.forEach((t) => { if (t?.user_id) userIds.add(String(t.user_id)); });
      replies.forEach((r) => { if (r?.user_id) userIds.add(String(r.user_id)); });

      let profiles = [];
      if (userIds.size) {
        const profileParams = new URLSearchParams({ select: 'id,full_name' });
        const filter = buildInFilter(userIds);
        if (filter) profileParams.append('id', filter);
        const profileData = await supabaseRequest(
          `${supaUrl}/rest/v1/profiles?${profileParams.toString()}`,
          { headers }
        );
        profiles = Array.isArray(profileData) ? profileData : [];
      }

      const authors = {};
      profiles.forEach((p) => {
        if (p?.id) authors[String(p.id)] = p.full_name || '';
      });

      return {
        status: 200,
        body: {
          topics,
          replies,
          authors,
        },
      };
    }

    if (action === 'create-topic') {
      const title = sanitizeTitle(body?.title ?? '');
      const content = sanitizeContent(body?.content ?? '');
      if (!title || !content) throw new HttpError(400, 'title and content required');
      const payload = {
        id: sanitizeId(body?.id) || randomUUID(),
        user_id: profileId,
        title,
        content,
        created_at: new Date().toISOString(),
      };
      const insertData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_topics`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }
      );
      const topic = Array.isArray(insertData) ? insertData[0] : insertData;
      return { status: 200, body: { topic } };
    }

    if (action === 'reply') {
      const topicId = normalizeId(body?.topicId ?? body?.topic_id ?? body?.id);
      if (!topicId) throw new HttpError(400, 'topic_id required');
      const content = sanitizeContent(body?.content ?? '');
      if (!content) throw new HttpError(400, 'content required');
      const payload = {
        topic_id: topicId,
        user_id: profileId,
        content,
      };
      const insertData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_replies`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }
      );
      const reply = Array.isArray(insertData) ? insertData[0] : insertData;
      return { status: 200, body: { reply } };
    }

    if (action === 'delete-topic') {
      const topicId = normalizeId(body?.topicId ?? body?.topic_id ?? body?.id);
      if (!topicId) throw new HttpError(400, 'topic_id required');
      const topicData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_topics?select=id,user_id&limit=1&id=eq.${encodeURIComponent(topicId)}`,
        { headers }
      );
      const topic = Array.isArray(topicData) ? topicData[0] : topicData;
      if (!topic) throw new HttpError(404, 'Topic not found');
      if (String(topic.user_id) !== profileId) throw new HttpError(403, 'Forbidden');
      await supabaseRequest(
        `${supaUrl}/rest/v1/forum_topics?id=eq.${encodeURIComponent(topicId)}`,
        { method: 'DELETE', headers }
      );
      await supabaseRequest(
        `${supaUrl}/rest/v1/forum_replies?topic_id=eq.${encodeURIComponent(topicId)}`,
        { method: 'DELETE', headers }
      );
      return { status: 200, body: { success: true } };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err && err.message ? err.message : err) } };
  }
}
