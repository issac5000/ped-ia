// Expose la configuration Supabase côté front (uniquement l’URL et la clé anonyme)
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const baseUrl = typeof rawUrl === 'string' ? rawUrl.trim().replace(/\/+$/, '') : '';
    if (!baseUrl) {
      throw new Error('Missing Supabase project URL');
    }

    const response = await fetch(`${baseUrl}/functions/v1/env`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const text = await response.text().catch(() => '') || '';
    if (!response.ok) {
      throw new Error(`Supabase env fetch failed (${response.status})${text ? `: ${text}` : ''}`);
    }

    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Invalid JSON returned by Supabase env function');
    }

    const candidate = payload && typeof payload === 'object' && payload.success ? (payload.data || {}) : payload;
    const anonKey = typeof candidate?.anonKey === 'string' && candidate.anonKey
      ? candidate.anonKey
      : typeof candidate?.SUPABASE_ANON_KEY === 'string' && candidate.SUPABASE_ANON_KEY
        ? candidate.SUPABASE_ANON_KEY
        : '';

    if (!anonKey) {
      throw new Error('Supabase env response missing anonKey');
    }

    return res.status(200).json({ success: true, data: { url: '/api/edge', anonKey } });
  } catch (error) {
    console.error('[api/env] Unable to resolve Supabase env', error);
    return res.status(500).json({ success: false, error: 'Unable to resolve Supabase env' });
  }
}
