import { randomBytes, randomUUID } from 'crypto';

// Crée un profil anonyme à l’aide de la clé service Supabase.
// Retourne l’identifiant et le code généré sans exiger d’authentification préalable.

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const MAX_CREATE_ATTEMPTS = 5;

// Génère un code alternant lettres et chiffres faciles à lire
function generateAnonCode() {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    const alphabet = i % 2 === 0 ? CODE_LETTERS : CODE_DIGITS;
    const index = bytes[i] % alphabet.length;
    out += alphabet[index];
  }
  return out;
}

// Indique si l’on doit retenter après une collision de code_unique
function shouldRetryDuplicate(status, detailsText) {
  if (status === 409) return true;
  if (!detailsText) return false;
  return /duplicate key value/i.test(detailsText) && /code_unique/i.test(detailsText);
}

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
    const basePayload = {};
    if (fullNameRaw) basePayload.full_name = fullNameRaw.slice(0, 120);

    let lastError = null;
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const insertPayload = {
        ...basePayload,
        id: randomUUID(),
        code_unique: generateAnonCode()
      };

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

      const text = await response.text().catch(() => '');
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch {}
      }

      if (response.ok) {
        const row = Array.isArray(json) ? json?.[0] : json;
        const id = row?.id || insertPayload.id;
        const code = row?.code_unique || insertPayload.code_unique;
        if (!id || !code) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(500).json({ error: 'Invalid response from Supabase' });
        }
        const profile = {
          id,
          code_unique: code,
          full_name: row?.full_name || basePayload.full_name || '',
          user_id: row?.user_id ?? null
        };
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).json({ profile });
      }

      const detailsText = json ? JSON.stringify(json) : text;
      if (shouldRetryDuplicate(response.status, detailsText)) {
        lastError = { status: response.status, details: detailsText };
        continue;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json({ error: 'Create failed', details: detailsText || undefined });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(lastError?.status || 500).json({ error: 'Create failed', details: lastError?.details });
  } catch (e) {
    console.error('[api/profiles/create-anon] handler error', e);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
