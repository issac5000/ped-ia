import { randomBytes, randomUUID } from 'crypto';

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

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
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
    console.warn('[api/guest-create] cleanup delete failed', err);
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

  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!supaUrl || !serviceKey) {
      setCors(res);
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    const rawBody = await readBody(req).catch(() => '');
    if (rawBody) {
      try {
        JSON.parse(rawBody);
      } catch (err) {
        setCors(res);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const email = generateGuestEmail();
    const password = generateGuestPassword(16);

    const createResponse = await fetch(`${supaUrl}/auth/v1/admin/users`, {
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

    const createText = await createResponse.text().catch(() => '');
    let createJson = null;
    if (createText) {
      try { createJson = JSON.parse(createText); } catch (err) {
        console.warn('[api/guest-create] unable to parse create user response', err);
      }
    }

    if (!createResponse.ok) {
      console.error('[api/guest-create] user create failed', createText);
      setCors(res);
      const message = createJson?.message || createJson?.error || 'Unable to create guest user';
      return res.status(500).json({ error: message || 'Unable to create guest user' });
    }

    const user = createJson?.user || createJson;
    const userId = user?.id || user?.user?.id;
    if (!userId) {
      console.error('[api/guest-create] missing user id in response');
      setCors(res);
      return res.status(500).json({ error: 'Invalid Supabase response' });
    }

    const profilePayload = {
      user_id: userId,
      is_guest: true,
      created_at: new Date().toISOString(),
    };

    const profileResponse = await fetch(`${supaUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(profilePayload),
    });

    if (!profileResponse.ok) {
      const details = await profileResponse.text().catch(() => '');
      console.error('[api/guest-create] profile insert failed', details);
      await deleteUserIfPossible(supaUrl, serviceKey, userId);
      setCors(res);
      return res.status(500).json({ error: 'Unable to create guest profile' });
    }

    setCors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ email, password });
  } catch (err) {
    console.error('[api/guest-create] handler error', err);
    setCors(res);
    return res.status(500).json({ error: 'Server error', details: err?.message || String(err) });
  }
}
