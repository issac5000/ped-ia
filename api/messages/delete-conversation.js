// Securely delete an entire conversation between the authenticated user and `otherId`.
// Uses Supabase service role to bypass RLS, but verifies the caller's identity first.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!serviceKey || !supaUrl) return res.status(500).json({ error: 'Server misconfigured' });

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Missing Authorization' });

    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
      req.on('error', reject);
    });

    const otherId = String(body.otherId || '').trim();
    if (!otherId) return res.status(400).json({ error: 'otherId required' });

    // Verify user token with GoTrue
    const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey || serviceKey
      }
    });
    if (!uRes.ok) {
      const t = await uRes.text().catch(()=>'');
      return res.status(401).json({ error: 'Invalid token', details: t });
    }
    const uJson = await uRes.json();
    const uid = String(uJson?.id || uJson?.user?.id || '').trim();
    if (!uid) return res.status(401).json({ error: 'Invalid token' });

    // Delete all messages in both directions using PostgREST
    const inner = `and(sender_id.eq.${uid},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${uid})`;
    const orParam = encodeURIComponent(inner);
    const dRes = await fetch(`${supaUrl}/rest/v1/messages?or=(${orParam})`, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      }
    });
    if (!dRes.ok) {
      const t = await dRes.text().catch(()=> '');
      return res.status(500).json({ error: 'Delete failed', details: t });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
