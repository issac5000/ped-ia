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
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    if (!serviceKey || !url) return res.status(500).json({ error: 'Server misconfigured' });

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

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Verify the caller's token and get their user id
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'Invalid token' });
    const uid = String(userData.user.id);

    // Only allow deleting a conversation where the caller is a participant
    // Perform a single delete covering both directions
    const { error: delErr } = await admin
      .from('messages')
      .delete()
      .or(`and(sender_id.eq.${uid},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${uid})`);
    if (delErr) return res.status(500).json({ error: 'Delete failed', details: delErr.message || String(delErr) });

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}

