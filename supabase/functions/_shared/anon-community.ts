// @ts-nocheck

import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  getSupabaseAdminClientInstance,
  normalizeCode,
  supabaseRequest,
} from './anon-children.ts';

// Utilitaires pour le forum anonyme : création de sujets, réponses et agrégation des dernières activités

function randomUUID() {
  return crypto.randomUUID();
}

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
    const payloadInput = body?.payload && typeof body.payload === 'object' ? body.payload : body;

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
      const pendingCountFallback = [];
      profiles.forEach((p) => {
        if (!p?.id) return;
        const key = String(p.id);
        const childrenCount = includeChildren && Array.isArray(p.children) ? p.children.length : null;
        let showFlag = null;
        if (showColumn) {
          if (Object.prototype.hasOwnProperty.call(p, 'show_children_count')) {
            showFlag = !!p.show_children_count;
          }
        }
        authors[key] = {
          full_name: p.full_name || '',
          children_count: childrenCount,
          child_count: childrenCount,
          show_children_count: showFlag,
          showChildCount: showFlag,
        };
        const meta = authors[key];
        console.debug('anon-community profile meta', {
          profileId: p.id,
          show_children_count: p.show_children_count,
          normalized: meta ? meta.showChildCount ?? meta.show_children_count ?? null : null,
        });
        if (showFlag === true || showFlag === null) {
          pendingCountFallback.push(key);
        }
      });

      if (pendingCountFallback.length) {
        const fallbackFilter = buildInFilter(pendingCountFallback);
        if (fallbackFilter) {
          try {
            const params = new URLSearchParams({ select: 'id,children_count,show_children_count' });
            params.append('id', fallbackFilter);
            const fallbackRows = await supabaseRequest(
              `${supaUrl}/rest/v1/profiles_with_children?${params.toString()}`,
              { headers }
            );
            (Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
              if (!row?.id) return;
              const key = String(row.id);
              if (!authors[key]) return;
              const countRaw = row.children_count ?? row.child_count ?? row.childrenCount ?? null;
              const parsed = Number(countRaw);
              if (Number.isFinite(parsed)) {
                authors[key].children_count = parsed;
                authors[key].child_count = parsed;
              }
              if (Object.prototype.hasOwnProperty.call(row, 'show_children_count')) {
                const normalizedShow = row.show_children_count === undefined ? null : !!row.show_children_count;
                authors[key].show_children_count = normalizedShow;
                authors[key].showChildCount = normalizedShow;
              }
              const meta = authors[key];
              console.debug('anon-community profile meta', {
                profileId: row.id,
                show_children_count: row.show_children_count,
                normalized: meta ? meta.showChildCount ?? meta.show_children_count ?? null : null,
              });
            });
          } catch (fallbackErr) {
            console.warn('profiles_with_children fallback failed', fallbackErr);
          }
        }
      }

      return {
        status: 200,
        body: {
          topics,
          replies,
          authors,
        },
      };
    }

    if (action === 'parent-preview') {
      const profileIdRaw =
        body?.profileId ??
        body?.profile_id ??
        body?.targetId ??
        body?.target_id ??
        body?.user_id ??
        body?.userId ??
        body?.id;
      const targetId = normalizeId(profileIdRaw);
      if (!targetId) throw new HttpError(400, 'profile_id required');
      const rpcHeaders = { ...headers, 'Content-Type': 'application/json' };
      let preview = null;
      try {
        const rpcPayload = await supabaseRequest(
          `${supaUrl}/rest/v1/rpc/get_parent_preview`,
          {
            method: 'POST',
            headers: rpcHeaders,
            body: JSON.stringify({ pid: targetId }),
          }
        );
        if (Array.isArray(rpcPayload) && rpcPayload.length > 0) {
          preview = rpcPayload[0] ?? null;
        } else if (rpcPayload && typeof rpcPayload === 'object') {
          preview = rpcPayload;
        }
      } catch (err) {
        console.warn('anon-community parent-preview rpc failed', err);
      }
      if (!preview) {
        try {
          const encodedId = encodeURIComponent(targetId);
          const profileRows = await supabaseRequest(
            `${supaUrl}/rest/v1/profiles?select=id,full_name&limit=1&id=eq.${encodedId}`,
            { headers }
          );
          const profileRow = Array.isArray(profileRows) ? profileRows[0] : profileRows;
          const childrenRows = await supabaseRequest(
            `${supaUrl}/rest/v1/children?select=id&user_id=eq.${encodedId}`,
            { headers }
          );
          const updatesRows = await supabaseRequest(
            `${supaUrl}/rest/v1/parent_updates?select=id,created_at&order=created_at.desc&limit=500&profile_id=eq.${encodedId}`,
            { headers }
          );
          const badgesRows = await supabaseRequest(
            `${supaUrl}/rest/v1/badges_parent?select=badge_level,badge_name,badge_icon,is_unlocked,unlocked_at&profile_id=eq.${encodedId}`,
            { headers }
          );
          const childCount = Array.isArray(childrenRows) ? childrenRows.length : 0;
          const updatesArray = Array.isArray(updatesRows) ? updatesRows : [];
          const totalUpdates = updatesArray.length;
          const lastUpdate = updatesArray.length ? updatesArray[0]?.created_at ?? updatesArray[0]?.createdAt ?? null : null;
          let badgeName = '';
          let badgeIcon = '';
          let bestLevel = -Infinity;
          (Array.isArray(badgesRows) ? badgesRows : []).forEach((row) => {
            if (!row) return;
            const unlockedRaw = row.is_unlocked ?? row.isUnlocked ?? null;
            const unlocked = unlockedRaw === true || unlockedRaw === 'true' || unlockedRaw === 1;
            if (!unlocked) return;
            const levelRaw = row.badge_level ?? row.badgeLevel ?? row.level;
            const level = Number(levelRaw);
            if (!Number.isFinite(level)) return;
            if (level > bestLevel) {
              bestLevel = level;
              badgeName = row.badge_name ?? row.badgeName ?? '';
              badgeIcon = row.badge_icon ?? row.badgeIcon ?? '';
            }
          });
          preview = {
            id: targetId,
            profile_id: targetId,
            full_name: profileRow?.full_name ?? profileRow?.fullName ?? 'Parent de la communauté',
            number_of_children: Number.isFinite(childCount) ? childCount : null,
            total_updates: totalUpdates,
            last_update: lastUpdate,
            badge_name: badgeName,
            badge_icon: badgeIcon,
          };
        } catch (fallbackErr) {
          console.warn('anon-community parent-preview fallback failed', fallbackErr);
        }
      }
      if (preview && typeof preview === 'object') {
        const sanitized = { ...preview };
        if (sanitized.profile_id == null) sanitized.profile_id = targetId;
        if (sanitized.profileId == null) sanitized.profileId = targetId;
        if (sanitized.id == null) sanitized.id = targetId;
        return { status: 200, body: { preview: sanitized } };
      }
      return { status: 200, body: { preview: null } };
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
      const topicId = normalizeId(payloadInput?.topicId ?? payloadInput?.topic_id ?? payloadInput?.id);
      if (!topicId) throw new HttpError(400, 'topic_id required');
      const content = sanitizeContent(payloadInput?.content ?? body?.content ?? '');
      if (!content) throw new HttpError(400, 'content required');
      const anonCodeValue = normalizeCode(payloadInput?.anon_code) || code;
      const payload = {
        topic_id: topicId,
        user_id: profileId,
        content,
        anon_code: anonCodeValue,
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

    if (action === 'delete-reply') {
      const replyId = normalizeId(payloadInput?.reply_id ?? payloadInput?.replyId ?? payloadInput?.id);
      const anonCode = normalizeCode(payloadInput?.anon_code ?? body?.anon_code ?? body?.code);
      console.log('[delete-reply] Payload reçu :', { replyId, anonCode });
      if (!replyId || !anonCode) {
        console.error('[delete-reply] Paramètres manquants', { replyId, anonCode });
        return { status: 400, body: { error: 'Missing reply_id or anon_code in payload.' } };
      }
      const existingData = await supabaseRequest(
        `${supaUrl}/rest/v1/forum_replies?select=id,anon_code,user_id&limit=1&id=eq.${encodeURIComponent(replyId)}`,
        { headers }
      );
      const existing = Array.isArray(existingData) ? existingData[0] : existingData;
      if (!existing) {
        console.warn('[delete-reply] Reply not found', replyId);
        return { status: 404, body: { error: 'Reply not found.' } };
      }
      const ownerId = existing?.user_id != null ? String(existing.user_id) : '';
      const existingAnonCode = normalizeCode(existing?.anon_code || '');
      console.log('[delete-reply] Owner:', { ownerId, existingAnonCode, profileId, anonCode });
      const supabaseAdmin = getSupabaseAdminClientInstance(supaUrl, serviceKey);
      const deleteLikes = async () => {
        const { error } = await supabaseAdmin
          .from('forum_reply_likes')
          .delete()
          .eq('reply_id', replyId);
        if (error) {
          console.warn('[delete-reply] Unable to delete reply likes', error);
        }
      };

      if (ownerId) {
        if (ownerId !== profileId) {
          console.warn('[delete-reply] Unauthorized user mismatch', { expected: ownerId, received: profileId });
          return { status: 403, body: { error: 'Unauthorized: cannot delete another user’s reply.' } };
        }
        await deleteLikes();
        const { error: deleteError } = await supabaseAdmin
          .from('forum_replies')
          .delete()
          .eq('id', replyId)
          .eq('user_id', profileId);
        if (deleteError) {
          console.error('[delete-reply] Delete error (auth user):', deleteError);
          return { status: 500, body: { error: deleteError.message || 'Delete failed.' } };
        }
      } else if (existingAnonCode) {
        if (existingAnonCode !== anonCode) {
          console.warn('[delete-reply] Unauthorized anon mismatch', { expected: existingAnonCode, received: anonCode });
          return { status: 403, body: { error: 'Unauthorized: cannot delete another user’s reply.' } };
        }
        await deleteLikes();
        const { error: deleteError } = await supabaseAdmin
          .from('forum_replies')
          .delete()
          .eq('id', replyId)
          .eq('anon_code', existingAnonCode);
        if (deleteError) {
          console.error('[delete-reply] Delete error (anon user):', deleteError);
          return { status: 500, body: { error: deleteError.message || 'Delete failed.' } };
        }
      } else {
        console.warn('[delete-reply] Reply owner indéterminé', existing);
        return { status: 403, body: { error: 'Unauthorized: cannot delete this reply.' } };
      }
      console.log('[delete-reply] Suppression réussie :', replyId);
      return { status: 200, body: { reply_id: replyId } };
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
      const pendingCountFallback = [];
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
            const childrenCount = includeChildren && Array.isArray(p.children) ? p.children.length : null;
            let showFlag = null;
            if (showColumn) {
              if (Object.prototype.hasOwnProperty.call(p, 'show_children_count')) {
                showFlag = !!p.show_children_count;
              }
            }
            authors[key] = {
              full_name: p.full_name || '',
              children_count: childrenCount,
              child_count: childrenCount,
              show_children_count: showFlag,
              showChildCount: showFlag,
            };
            const meta = authors[key];
            console.debug('anon-community profile meta', {
              profileId: p.id,
              show_children_count: p.show_children_count,
              normalized: meta ? meta.showChildCount ?? meta.show_children_count ?? null : null,
            });
            if (showFlag === true || showFlag === null) {
              pendingCountFallback.push(key);
            }
          });
        }
      }
      if (pendingCountFallback.length) {
        const fallbackFilter = buildInFilter(pendingCountFallback);
        if (fallbackFilter) {
          try {
            const params = new URLSearchParams({ select: 'id,children_count,show_children_count' });
            params.append('id', fallbackFilter);
            const fallbackRows = await supabaseRequest(
              `${supaUrl}/rest/v1/profiles_with_children?${params.toString()}`,
              { headers }
            );
            (Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
              if (!row?.id) return;
              const key = String(row.id);
              if (!authors[key]) return;
              const countRaw = row.children_count ?? row.child_count ?? row.childrenCount ?? null;
              const parsed = Number(countRaw);
              if (Number.isFinite(parsed)) {
                authors[key].children_count = parsed;
                authors[key].child_count = parsed;
              }
              if (Object.prototype.hasOwnProperty.call(row, 'show_children_count')) {
                const normalizedShow = row.show_children_count === undefined ? null : !!row.show_children_count;
                authors[key].show_children_count = normalizedShow;
                authors[key].showChildCount = normalizedShow;
              }
              const meta = authors[key];
              console.debug('anon-community profile meta', {
                profileId: row.id,
                show_children_count: row.show_children_count,
                normalized: meta ? meta.showChildCount ?? meta.show_children_count ?? null : null,
              });
            });
          } catch (fallbackErr) {
            console.warn('profiles_with_children fallback (recent replies) failed', fallbackErr);
          }
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
