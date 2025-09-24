import { randomBytes, randomUUID } from 'crypto';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function generateGuestEmail() {
  return `anon_${randomUUID()}@guest.local`;
}

function generateGuestPassword(length = 16) {
  let output = '';
  while (output.length < length) {
    output += randomBytes(length).toString('base64url');
  }
  return output.slice(0, Math.max(length, 12));
}

async function fetchProfileByUserId(supaUrl, serviceKey, userId) {
  const url = `${supaUrl}/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const err = new Error(text || 'Unable to fetch profile');
    err.status = response.status;
    err.details = text;
    throw err;
  }
  if (!text) return null;
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json) && json.length > 0) {
      return json[0] || null;
    }
    return null;
  } catch (err) {
    const parseErr = new Error('Invalid JSON response from Supabase');
    parseErr.cause = err;
    throw parseErr;
  }
}

async function insertProfile(supaUrl, serviceKey, payload) {
  const response = await fetch(`${supaUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const err = new Error(text || 'Unable to insert profile');
    err.status = response.status;
    err.details = text;
    throw err;
  }
  if (!text) return null;
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json) && json.length > 0) {
      return json[0] || null;
    }
    return null;
  } catch (err) {
    const parseErr = new Error('Invalid JSON response from Supabase');
    parseErr.cause = err;
    throw parseErr;
  }
}

async function createGuestUser(supaUrl, serviceKey) {
  const email = generateGuestEmail();
  const password = generateGuestPassword(16);
  const response = await fetch(`${supaUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { is_guest: true },
      app_metadata: { role: 'guest' },
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const err = new Error(text || 'Unable to create guest user');
    err.status = response.status;
    err.details = text;
    throw err;
  }
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      const parseErr = new Error('Invalid JSON response from Supabase');
      parseErr.cause = err;
      throw parseErr;
    }
  }
  const user = json?.user || json;
  const userId = user?.id || user?.user?.id;
  if (!userId) {
    throw new Error('Missing user id in Supabase response');
  }
  return { userId, email, password };
}

async function deleteUserIfPossible(supaUrl, serviceKey, userId) {
  if (!userId) return;
  try {
    await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
  } catch (err) {
    console.warn('[api/profile-ensure] cleanup delete failed', err);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    setCors(res);
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!supaUrl || !serviceKey) {
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    const rawBody = await readBody(req).catch(() => '');
    let payload = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    let userId = payload?.userId ? String(payload.userId) : '';
    const isGuest = !!payload?.isGuest;

    let existingProfile = null;
    if (userId) {
      try {
        existingProfile = await fetchProfileByUserId(supaUrl, serviceKey, userId);
      } catch (err) {
        console.error('[api/profile-ensure] profile lookup failed', err);
        return res.status(500).json({ error: 'Unable to fetch profile' });
      }
      if (existingProfile) {
        return res.status(200).json({ profile: existingProfile, credentials: null });
      }
    }

    let credentials = null;

    if (isGuest) {
      if (!userId) {
        let created;
        try {
          created = await createGuestUser(supaUrl, serviceKey);
        } catch (err) {
          console.error('[api/profile-ensure] guest user creation failed', err);
          return res.status(500).json({ error: 'Unable to create guest user' });
        }
        userId = created.userId;
        credentials = { email: created.email, password: created.password };
      }

      try {
        existingProfile = await fetchProfileByUserId(supaUrl, serviceKey, userId);
      } catch (err) {
        console.error('[api/profile-ensure] profile lookup after guest creation failed', err);
        return res.status(500).json({ error: 'Unable to fetch profile' });
      }
      if (existingProfile) {
        return res.status(200).json({ profile: existingProfile, credentials });
      }

      const profilePayload = {
        id: randomUUID(),
        user_id: userId,
        is_guest: true,
      };

      try {
        const inserted = await insertProfile(supaUrl, serviceKey, profilePayload);
        return res.status(200).json({ profile: inserted, credentials });
      } catch (err) {
        console.error('[api/profile-ensure] guest profile insert failed', err);
        if (credentials?.email) {
          await deleteUserIfPossible(supaUrl, serviceKey, userId).catch(() => {});
        }
        return res.status(500).json({ error: 'Unable to create guest profile' });
      }
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const profilePayload = {
      id: randomUUID(),
      user_id: userId,
      is_guest: false,
    };

    try {
      const inserted = await insertProfile(supaUrl, serviceKey, profilePayload);
      return res.status(200).json({ profile: inserted, credentials: null });
    } catch (err) {
      console.error('[api/profile-ensure] profile insert failed', err);
      return res.status(500).json({ error: 'Unable to create profile' });
    }
  } catch (err) {
    console.error('[api/profile-ensure] handler error', err);
    return res.status(500).json({ error: 'Server error', details: err?.message || String(err) });
  }
}
