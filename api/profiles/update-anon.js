const KEY_MAP = {
  fullName: 'full_name',
  avatarUrl: 'avatar_url',
  avatarURL: 'avatar_url'
};

const DISALLOWED_FIELDS = new Set(['id', 'user_id', 'code_unique', 'created_at', 'updated_at']);

function camelToSnake(key) {
  if (!key) return key;
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (!/[A-Z]/.test(key)) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function normalizeFullName(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 120);
}

function normalizeAvatarUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 2048);
}

function normalizeField(key, value) {
  if (key === 'full_name') return normalizeFullName(value);
  if (key === 'avatar_url') return normalizeAvatarUrl(value);
  return value;
}

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

function buildUpdatePayload(payload) {
  const update = {};
  for (const [rawKey, value] of Object.entries(payload || {})) {
    const key = camelToSnake(rawKey);
    if (key === 'code_unique' || DISALLOWED_FIELDS.has(key)) continue;
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
    if (!Object.keys(updatePayload).length) {
      console.error('updateAnonProfile no valid fields to update', payload);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const profileQuery = `${supaUrl}/rest/v1/profiles?select=id,user_id,code_unique,full_name,avatar_url&code_unique=eq.${encodeURIComponent(code)}&limit=1`;
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
    if (!existing) {
      console.error('updateAnonProfile code not found', code);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).json({ error: 'Code not found' });
    }

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
      user_id: updated.user_id ?? existing.user_id ?? null
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ profile });
  } catch (e) {
    console.error('updateAnonProfile handler error', e);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
