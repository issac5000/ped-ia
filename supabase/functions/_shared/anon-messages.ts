// @ts-nocheck

import {
  HttpError,
  fetchAnonProfile,
  getServiceConfig,
  normalizeCode,
  supabaseRequest,
} from './anon-children.ts';

// Couche métier pour la messagerie anonyme (listes, notifications récentes, envoi, suppression)

// Nettoie le message libre envoyé par un parent anonyme (trim + limitation de taille)
function sanitizeMessage(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  return str.slice(0, 2000);
}

// Transforme n’importe quel identifiant en chaîne pour uniformiser les comparaisons
function normalizeId(value) {
  if (value == null) return '';
  return String(value).trim();
}

// Construit un filtre in.() sécurisé pour PostgREST à partir d’un ensemble d’identifiants
function buildInFilter(values) {
  const safe = Array.from(values || [])
    .map((v) => normalizeId(v))
    .filter(Boolean)
    .map((v) => `"${v.replace(/"/g, '""')}"`);
  if (!safe.length) return '';
  return `in.(${safe.join(',')})`;
}

// Calcule une date ISO à partir d’une valeur fournie (ou d’un nombre de jours de recul par défaut)
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

// Convertit les identifiants numériques éventuels en chaînes pour simplifier l’affichage côté front
function mapMessage(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    ...row,
    sender_id: row.sender_id != null ? String(row.sender_id) : row.sender_id,
    receiver_id: row.receiver_id != null ? String(row.receiver_id) : row.receiver_id,
  };
}

// Récupère un profil minimal (id + full_name) pour enrichir les conversations
async function fetchProfileById(supaUrl, headers, id) {
  const res = await supabaseRequest(
    `${supaUrl}/rest/v1/profiles?select=id,full_name&limit=1&id=eq.${encodeURIComponent(id)}`,
    { headers }
  );
  return Array.isArray(res) ? res[0] : res;
}

function summarizeValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value != null ? 1 : 0;
}

function logResponse(action, body) {
  const summary = {};
  Object.entries(body || {}).forEach(([key, value]) => {
    summary[key] = summarizeValue(value);
  });
  console.debug(`[anon-messages] ${action} response`, summary);
}

/**
 * Point d’entrée unique pour toutes les actions de messagerie anonyme.
 * Garantit que chaque requête est liée à un profil anonyme valide avant d’interroger Supabase.
 */
export async function processAnonMessagesRequest(body) {
  let self = null;
  let action = '';
  try {
    action = String(body?.action || '').trim();
    if (!action) throw new HttpError(400, 'action required');
    const code = normalizeCode(body?.code || body?.code_unique);
    if (!code) throw new HttpError(400, 'code required');

    const { supaUrl, serviceKey } = getServiceConfig();
    const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const profileId = String(profile.id);
    self = { id: profileId, full_name: profile.full_name || '' };

    if (action === 'profile-self') {
      const body = { self };
      logResponse(action, body);
      return { status: 200, body };
    }

    if (action === 'profile') {
      const otherId = normalizeId(body?.otherId ?? body?.id);
      if (!otherId) throw new HttpError(400, 'otherId required');
      const other = await fetchProfileById(supaUrl, headers, otherId);
      if (!other) {
        const errorBody = { self, error: 'Profile not found' };
        logResponse(action, errorBody);
        return { status: 404, body: errorBody };
      }
      const responseBody = { self, profile: other };
      logResponse(action, responseBody);
      return { status: 200, body: responseBody };
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
      const responseBody = {
        self,
        conversations,
        profiles: profilesList,
      };
      logResponse(action, responseBody);
      return {
        status: 200,
        body: responseBody,
      };
    }

    if (action === 'recent-activity') {
      const sinceIso = sanitizeSince(body?.since, 7);
      const params = new URLSearchParams({
        select: 'id,sender_id,receiver_id,created_at',
        order: 'created_at.asc',
        limit: '50',
      });
      params.append('receiver_id', `eq.${profileId}`);
      if (sinceIso) params.append('created_at', `gt.${sinceIso}`);
      const rows = await supabaseRequest(
        `${supaUrl}/rest/v1/messages?${params.toString()}`,
        { headers }
      );
      const messages = Array.isArray(rows) ? rows.map(mapMessage).filter(Boolean) : [];
      const senderIds = Array.from(new Set(messages.map((m) => m?.sender_id).filter(Boolean)));
      const senders = {};
      if (senderIds.length) {
        const filter = buildInFilter(senderIds);
        if (filter) {
          const profParams = new URLSearchParams({ select: 'id,full_name' });
          profParams.append('id', filter);
          const profRows = await supabaseRequest(
            `${supaUrl}/rest/v1/profiles?${profParams.toString()}`,
            { headers }
          );
          (Array.isArray(profRows) ? profRows : []).forEach((p) => {
            if (p?.id != null) senders[String(p.id)] = p.full_name || '';
          });
        }
      }
      const responseBody = { self, messages, senders };
      logResponse(action, responseBody);
      return { status: 200, body: responseBody };
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
      const responseBody = { self, messages, profile: other || null };
      logResponse(action, responseBody);
      return { status: 200, body: responseBody };
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
      const responseBody = { self, message: mapMessage(message) };
      logResponse(action, responseBody);
      return { status: 200, body: responseBody };
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
      const responseBody = { self, success: true };
      logResponse(action, responseBody);
      return { status: 200, body: responseBody };
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    if (err instanceof HttpError) {
      const errorBody = { error: err.message, details: err.details };
      if (self) errorBody.self = self;
      if (action) logResponse(action, errorBody);
      return { status: err.status || 500, body: errorBody };
    }
    const errorBody = {
      error: 'Server error',
      details: String(err && err.message ? err.message : err),
    };
    if (self) errorBody.self = self;
    if (action) logResponse(action, errorBody);
    return { status: 500, body: errorBody };
  }
}
