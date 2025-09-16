// Create an anonymous profile using the Supabase service role key.
// Returns the generated id + code without requiring the user to be authenticated.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    if (!serviceKey || !supaUrl) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let payload = {};
    if (body) {
      try { payload = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
    }

    const fullNameRaw = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
    const insertPayload = {};
    if (fullNameRaw) insertPayload.full_name = fullNameRaw.slice(0, 120);

    const response = await fetch(`${supaUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertPayload)
    });

    const text = await response.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }

    if (!response.ok) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json({ error: 'Create failed', details: text || undefined });
    }

    const row = Array.isArray(json) ? json[0] : json;
    if (!row?.id || !row?.code_unique) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'Invalid response from Supabase' });
    }

    const profile = {
      id: row.id,
      code_unique: row.code_unique,
      full_name: row.full_name || '',
      user_id: row.user_id ?? null
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ profile });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
