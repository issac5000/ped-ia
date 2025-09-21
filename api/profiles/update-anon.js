import { randomUUID } from 'crypto';

// Route API dédiée à la mise à jour des profils anonymes via leur code unique
const KEY_MAP = {
  fullName: 'full_name',
  avatarUrl: 'avatar_url',
  avatarURL: 'avatar_url',
  role: 'parent_role',
  parentRole: 'parent_role'
};

const DISALLOWED_FIELDS = new Set(['id', 'user_id', 'code_unique', 'code', 'created_at', 'updated_at']);
const ALLOWED_UPDATE_FIELDS = new Set([
  'full_name',
  'avatar_url',
  'parent_role',
  'show_children_count',
]);

// Convertit une clé camelCase en snake_case compatible avec la base
function camelToSnake(key) {
  if (!key) return key;
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (!/[A-Z]/.test(key)) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// Nettoie et limite le nom complet (ou autorise null pour l’effacer)
function normalizeFullName(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 120);
}

// Valide et tronque l’URL d’avatar transmise par le parent
function normalizeAvatarUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 2048);
}

const ALLOWED_PARENT_ROLES = new Map([
  ['maman', 'maman'],
  ['mere', 'maman'],
  ['mère', 'maman'],
  ['papa', 'papa'],
  ['pere', 'papa'],
  ['père', 'papa'],
  ['parent', 'parent'],
  ['tuteur', 'tuteur'],
  ['famille', 'famille'],
  ['autre', 'autre'],
]);

function normalizeParentRole(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (ALLOWED_PARENT_ROLES.has(lower)) return ALLOWED_PARENT_ROLES.get(lower);
  return lower.slice(0, 30);
}

// Applique le normaliseur spécifique selon le champ ciblé
function normalizeField(key, value) {
  if (key === 'full_name') return normalizeFullName(value);
  if (key === 'avatar_url') return normalizeAvatarUrl(value);
  if (key === 'parent_role') return normalizeParentRole(value);
  if (key === 'show_children_count') {
    if (value === null) return null;
    if (typeof value === 'boolean') return value;
    return undefined;
  }
  return value;
}

// Récupère le code unique en acceptant plusieurs alias (code, codeUnique, code_unique)
function extractCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const keys = ['code_unique', 'codeUnique', 'code'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed.toUpperCase();
    }
    if (typeof value === 'number') {
      const str = String(value).trim();
      if (str) return str.toUpperCase();
    }
  }
  return '';
}

// Construit le patch envoyé à Supabase en excluant les champs interdits
function buildUpdatePayload(payload) {
  const update = {};
  for (const [rawKey, value] of Object.entries(payload || {})) {
    const key = camelToSnake(rawKey);
    if (key === 'code_unique' || DISALLOWED_FIELDS.has(key)) continue;
    if (!ALLOWED_UPDATE_FIELDS.has(key)) continue;
    const normalizedValue = normalizeField(key, value);
    if (normalizedValue === undefined) continue;
    update[key] = normalizedValue;
  }
  return update;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    if (!serviceKey || !supaUrl) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let payload = {};
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch (e) {
        console.error('updateAnonProfile invalid JSON body', e);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const code = extractCode(payload);
    if (!code) {
      console.error('updateAnonProfile missing code_unique');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'code_unique is required' });
    }

    const updatePayload = buildUpdatePayload(payload);
    if (!Object.prototype.hasOwnProperty.call(updatePayload, 'full_name')) {
      console.error('updateAnonProfile missing full_name');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'full_name is required' });
    }
    if (typeof updatePayload.full_name !== 'string') {
      console.error('updateAnonProfile invalid full_name type');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'full_name must be a string' });
    }

    const profileQuery = `${supaUrl}/rest/v1/profiles?select=id,user_id,code_unique,full_name,avatar_url,parent_role,show_children_count&code_unique=eq.${encodeURIComponent(code)}&limit=1`;
    const profileRes = await fetch(profileQuery, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    if (!profileRes.ok) {
      const details = await profileRes.text().catch(() => '');
      console.error('updateAnonProfile fetch existing failed', profileRes.status, details);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Failed to fetch profile', details: details || undefined });
    }

    const existingList = await profileRes.json().catch(() => []);
    const existing = Array.isArray(existingList) ? existingList[0] : existingList;
    if (existing) {
      if (existing.user_id) {
        console.error('updateAnonProfile non anonymous profile attempted update', { code, user_id: existing.user_id });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(403).json({ error: 'Only anonymous profiles can update via code' });
      }

      const updateUrl = `${supaUrl}/rest/v1/profiles?code_unique=eq.${encodeURIComponent(code)}`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(updatePayload)
      });

      const updateText = await updateRes.text().catch(() => '');
      let updateJson = null;
      if (updateText) {
        try {
          updateJson = JSON.parse(updateText);
        } catch (e) {
          console.error('updateAnonProfile invalid JSON response', e);
        }
      }

      if (!updateRes.ok) {
        console.error('updateAnonProfile update failed', updateRes.status, updateText);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(updateRes.status).json({ error: 'Update failed', details: updateText || undefined });
      }

      const updated = Array.isArray(updateJson) ? updateJson[0] : updateJson;
      if (!updated) {
        console.error('updateAnonProfile update returned empty payload', updateJson);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(500).json({ error: 'Update succeeded but no data returned' });
      }

      const profile = {
        id: updated.id || existing.id,
        code_unique: updated.code_unique || existing.code_unique || code,
        full_name: typeof updated.full_name === 'string' ? updated.full_name : existing.full_name || '',
        avatar_url: Object.prototype.hasOwnProperty.call(updated, 'avatar_url') ? updated.avatar_url : (existing.avatar_url ?? null),
        parent_role: Object.prototype.hasOwnProperty.call(updated, 'parent_role') ? updated.parent_role : (existing.parent_role ?? null),
        show_children_count: Object.prototype.hasOwnProperty.call(updated, 'show_children_count') ? updated.show_children_count : (existing.show_children_count ?? null),
        user_id: updated.user_id ?? existing.user_id ?? null
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ profile });
    }

    const insertPayload = {
      ...updatePayload,
      id: randomUUID(),
      code_unique: code,
      user_id: null
    };

    const insertRes = await fetch(`${supaUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertPayload)
    });

    const insertText = await insertRes.text().catch(() => '');
    let insertJson = null;
    if (insertText) {
      try {
        insertJson = JSON.parse(insertText);
      } catch (e) {
        console.error('updateAnonProfile invalid insert JSON response', e);
      }
    }

    if (!insertRes.ok) {
      console.error('updateAnonProfile insert failed', insertRes.status, insertText);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(insertRes.status).json({ error: 'Insert failed', details: insertText || undefined });
    }

    const created = Array.isArray(insertJson) ? insertJson[0] : insertJson;
    if (!created) {
      console.error('updateAnonProfile insert returned empty payload', insertJson);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Insert succeeded but no data returned' });
    }

    const profile = {
      id: created.id || insertPayload.id,
      code_unique: created.code_unique || code,
      full_name: typeof created.full_name === 'string' ? created.full_name : updatePayload.full_name,
      avatar_url: Object.prototype.hasOwnProperty.call(created, 'avatar_url') ? created.avatar_url : (updatePayload.avatar_url ?? null),
      parent_role: Object.prototype.hasOwnProperty.call(created, 'parent_role') ? created.parent_role : (updatePayload.parent_role ?? null),
      show_children_count: Object.prototype.hasOwnProperty.call(created, 'show_children_count') ? created.show_children_count : (updatePayload.show_children_count ?? null),
      user_id: created.user_id ?? null
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ profile });
  } catch (e) {
    console.error('updateAnonProfile handler error', e);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
