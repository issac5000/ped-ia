import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.js';

function sanitizeMessage(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  return str.slice(0, 2000);
}

function normalizeId(value) {
  if (value == null) return '';
  return String(value).trim();
}

function buildInFilter(values) {
  const safe = Array.from(values || [])
    .map((v) => normalizeId(v))
    .filter(Boolean)
    .map((v) => `"${v.replace(/"/g, '""')}"`);
  if (!safe.length) return '';
  return `in.(${safe.join(',')})`;
}

function mapMessage(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    ...row,
    sender_id: row.sender_id != null ? String(row.sender_id) : row.sender_id,
    receiver_id: row.receiver_id != null ? String(row.receiver_id) : row.receiver_id,
  };
}

async function fetchProfileById(supaUrl, headers, id) {
  const res = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=id,full_name&limit=1&id=eq.${encodeURIComponent(id)}`,
    { headers }
  );
  return Array.isArray(res) ? res[0] : res;
}

export async function processAnonMessagesRequest(body) {
  try {
    const action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'code required');

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = String(profile.id);

    if (action === 'profile-self') {
      return { status: 200, body: { profile: { id: profileId, full_name: profile.full_name || '' } } };
    }

    if (action === 'profile') {
      const otherId = normalizeId(body?.otherId ?? body?.id);
      if (!otherId) throw new HttpError(400, 'otherId required');
      const other = await fetchProfileById(supaUrl, headers, otherId);
      if (!other) return { status: 404, body: { error: 'Profile not found' } };
      return { status: 200, body: { profile: other } };
    }

    if (action === 'list-conversations') {
      const params = new URLSearchParams({
        select: 'id,sender_id,receiver_id,content,created_at',
        order: 'created_at.desc',
        limit: '200',
      });
      params.append('or', `(sender_id.eq.${profileId},receiver_id.eq.${profileId})`);
      const rows = await supabaseRequest(
        `${supaUrl}/rest/v1/messages?${params.toString()}`,
        { headers }
      );
      const data = Array.isArray(rows) ? rows : [];
      const convMap = new Map();
      data.forEach((row) => {
        const sender = row?.sender_id != null ? String(row.sender_id) : '';
        const receiver = row?.receiver_id != null ? String(row.receiver_id) : '';
        const other = sender === profileId ? receiver : sender;
        if (!other) return;
        if (!convMap.has(other)) convMap.set(other, mapMessage(row));
      });
      const conversations = Array.from(convMap.entries()).map(([otherId, msg]) => ({
        otherId,
        lastMessage: msg,
      }));
      const ids = conversations.map((c) => c.otherId);
      const filter = buildInFilter(ids);
      let profilesList = [];
      if (filter) {
        const profParams = new URLSearchParams({ select: 'id,full_name' });
        profParams.append('id', filter);
        const profRes = await supabaseRequest(
          `${supaUrl}/rest/v1/profiles?${profParams.toString()}`,
          { headers }
        );
        profilesList = Array.isArray(profRes) ? profRes : [];
      }
      return {
        status: 200,
        body: {
          self: { id: profileId, full_name: profile.full_name || '' },
          conversations,
          profiles: profilesList,
        },
      };
    }

    if (action === 'get-conversation') {
      const otherId = normalizeId(body?.otherId ?? body?.id);
      if (!otherId) throw new HttpError(400, 'otherId required');
      const params = new URLSearchParams({
        select: 'id,sender_id,receiver_id,content,created_at',
        order: 'created_at.asc',
      });
      params.append(
        'or',
        `(and(sender_id.eq.${profileId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${profileId}))`
      );
      const rows = await supabaseRequest(
        `${supaUrl}/rest/v1/messages?${params.toString()}`,
        { headers }
      );
      const messages = Array.isArray(rows) ? rows.map(mapMessage).filter(Boolean) : [];
      const other = await fetchProfileById(supaUrl, headers, otherId);
      return { status: 200, body: { messages, profile: other || null } };
    }

    if (action === 'send') {
      const otherId = normalizeId(body?.otherId ?? body?.receiverId);
      if (!otherId) throw new HttpError(400, 'otherId required');
      if (otherId === profileId) throw new HttpError(400, 'Cannot send messages to self');
      const content = sanitizeMessage(body?.content ?? '');
      if (!content) throw new HttpError(400, 'content required');
      const payload = {
        sender_id: profileId,
        receiver_id: otherId,
        content,
      };
      const inserted = await supabaseRequest(
        `${supaUrl}/rest/v1/messages`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }
      );
      const message = Array.isArray(inserted) ? inserted[0] : inserted;
      return { status: 200, body: { message: mapMessage(message) } };
    }

    if (action === 'delete-conversation') {
      const otherId = normalizeId(body?.otherId ?? body?.id);
      if (!otherId) throw new HttpError(400, 'otherId required');
      await supabaseRequest(
        `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(profileId)}&receiver_id=eq.${encodeURIComponent(otherId)}`,
        { method: 'DELETE', headers }
      );
      await supabaseRequest(
        `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(otherId)}&receiver_id=eq.${encodeURIComponent(profileId)}`,
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
