import { randomUUID } from 'crypto';
import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.js';

// Utilitaires pour le forum anonyme : création de sujets, réponses et agrégation des dernières activités

// Nettoie une chaîne libre en coupant les espaces superflus et en limitant la longueur
function sanitizeString(raw, max = 500) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  return str.slice(0, max);
}

function sanitizeTitle(raw) {
  const title = sanitizeString(raw, 160);
  if (!title) return '';
  // Réduit les espaces consécutifs tout en conservant une séparation lisible
  return title.replace(/\s+/g, ' ').trim();
}

function sanitizeContent(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  // Limite le contenu à une taille raisonnable pour éviter les abus
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

function sanitizeSince(raw, fallbackDays = null) {
  if (raw != null) {
    const str = String(raw).trim();
    if (str) {
      const time = Date.parse(str);
      if (!Number.isNaN(time)) {
        return new Date(time).toISOString();
      }
    }
  }
  if (fallbackDays != null) {
    const ms = Date.now() - Math.max(0, Number(fallbackDays) || 0) * 24 * 3600 * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

/**
 * Route unique pour toutes les actions anonymes du forum (liste, création, réponses, etc.).
 * Chaque appel vérifie le code anonyme puis applique les règles d’accès avant d’interroger Supabase.
 */
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
      let showColumn = true;
      let includeChildren = true;
      if (userIds.size) {
        const profileParams = new URLSearchParams({ select: 'id,full_name,show_children_count,children:children(id)' });
        const filter = buildInFilter(userIds);
        if (filter) profileParams.append('id', filter);
        try {
          const profileData = await supabaseRequest(
            `${supaUrl}/rest/v1/profiles?${profileParams.toString()}`,
            { headers }
          );
          profiles = Array.isArray(profileData) ? profileData : [];
        } catch (err) {
          showColumn = false;
          includeChildren = false;
          profileParams.set('select', 'id,full_name');
          const profileData = await supabaseRequest(
            `${supaUrl}/rest/v1/profiles?${profileParams.toString()}`,
            { headers }
          );
          profiles = Array.isArray(profileData) ? profileData : [];
        }
      }

      const authors = {};
      profiles.forEach((p) => {
        if (!p?.id) return;
        const key = String(p.id);
        const isSelf = key === profileId;
        const childrenCount =
          isSelf && includeChildren && Array.isArray(p.children)
            ? p.children.length
            : null;
        const showFlag = showColumn && isSelf ? !!p.show_children_count : false;
        authors[key] = {
          full_name: p.full_name || '',
          children_count: childrenCount,
          child_count: childrenCount,
          show_children_count: showFlag,
        };
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
      if (String(topic.user_id) !== profileId) throw new HttpError(403, 'Accès non autorisé');
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

    if (action === 'recent-replies') {
      const sinceIso = sanitizeSince(body?.since, 7);
      const ownParams = new URLSearchParams({ select: 'id', limit: '200' });
      ownParams.append('user_id', `eq.${profileId}`);
      const owned = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_topics?${ownParams.toString()}`,
        { headers }
      );
      const myTopics = Array.isArray(owned) ? owned : [];
      const repliedParams = new URLSearchParams({ select: 'topic_id', limit: '500' });
      repliedParams.append('user_id', `eq.${profileId}`);
      const replied = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_replies?${repliedParams.toString()}`,
        { headers }
      );
      const myReplies = Array.isArray(replied) ? replied : [];
      const topicIdSet = new Set();
      myTopics.forEach((t) => { if (t?.id != null) topicIdSet.add(String(t.id)); });
      myReplies.forEach((r) => { if (r?.topic_id != null) topicIdSet.add(String(r.topic_id)); });
      if (!topicIdSet.size) {
        return { status: 200, body: { replies: [], authors: {}, topics: {} } };
      }
      const repliesParams = new URLSearchParams({
        select: 'id,topic_id,user_id,created_at',
        order: 'created_at.asc',
        limit: '100',
      });
      const inFilter = buildInFilter(topicIdSet);
      if (inFilter) repliesParams.append('topic_id', inFilter);
      repliesParams.append('user_id', `neq.${profileId}`);
      if (sinceIso) repliesParams.append('created_at', `gt.${sinceIso}`);
      const repliesData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_replies?${repliesParams.toString()}`,
        { headers }
      );
      const replies = Array.isArray(repliesData)
        ? repliesData.map((r) => ({
            ...r,
            topic_id: r?.topic_id != null ? String(r.topic_id) : r?.topic_id,
            user_id: r?.user_id != null ? String(r.user_id) : r?.user_id,
          }))
        : [];
      if (!replies.length) {
        return { status: 200, body: { replies: [], authors: {}, topics: {} } };
      }
      const authorIds = Array.from(new Set(replies.map((r) => r.user_id).filter(Boolean)));
      const authors = {};
      if (authorIds.length) {
        const authorFilter = buildInFilter(authorIds);
        if (authorFilter) {
          const authorParams = new URLSearchParams({ select: 'id,full_name,show_children_count,children:children(id)' });
          authorParams.append('id', authorFilter);
          let authorRows = [];
          let showColumn = true;
          let includeChildren = true;
          try {
            const rows = await supabaseRequest(
              `${supaUrl}/rest/v1/profiles?${authorParams.toString()}`,
              { headers }
            );
            authorRows = Array.isArray(rows) ? rows : [];
          } catch (err) {
            showColumn = false;
            includeChildren = false;
            authorParams.set('select', 'id,full_name');
            const rows = await supabaseRequest(
              `${supaUrl}/rest/v1/profiles?${authorParams.toString()}`,
              { headers }
            );
            authorRows = Array.isArray(rows) ? rows : [];
          }
          authorRows.forEach((p) => {
            if (p?.id == null) return;
            const key = String(p.id);
            const childrenCount = includeChildren && Array.isArray(p.children) ? p.children.length : 0;
            const showFlag = showColumn ? !!p.show_children_count : false;
            authors[key] = {
              full_name: p.full_name || '',
              children_count: childrenCount,
              child_count: childrenCount,
              show_children_count: showFlag,
            };
          });
        }
      }
      const replyTopicIds = new Set(replies.map((r) => r.topic_id).filter(Boolean));
      const topicsMap = {};
      if (replyTopicIds.size) {
        const topicFilter = buildInFilter(replyTopicIds);
        if (topicFilter) {
          const topicParams = new URLSearchParams({ select: 'id,title' });
          topicParams.append('id', topicFilter);
          const topicRows = await supabaseRequest(
            `${supaUrl}/rest/v1/forum_topics?${topicParams.toString()}`,
            { headers }
          );
          (Array.isArray(topicRows) ? topicRows : []).forEach((t) => {
            if (t?.id != null) topicsMap[String(t.id)] = t.title || '';
          });
        }
      }
      return { status: 200, body: { replies, authors, topics: topicsMap } };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status || 500, body: { error: err.message, details: err.details } };
    }
    return { status: 500, body: { error: 'Server error', details: String(err && err.message ? err.message : err) } };
  }
}
