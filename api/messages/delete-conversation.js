// Supprime en toute sécurité une conversation complète entre l’utilisateur authentifié et « otherId ».
// Utilise la clé service Supabase pour passer outre la RLS après vérification de l’identité du demandeur.
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

    // Vérifie le jeton utilisateur auprès de GoTrue
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

    // Supprime tous les messages dans les deux sens via deux appels distincts (plus simple qu’un filtre or=)
    const q1 = `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(uid)}&receiver_id=eq.${encodeURIComponent(otherId)}`;
    const q2 = `${supaUrl}/rest/v1/messages?sender_id=eq.${encodeURIComponent(otherId)}&receiver_id=eq.${encodeURIComponent(uid)}`;
    for (const url of [q1, q2]) {
      const dRes = await fetch(url, {
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
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', details: String(e.message || e) });
  }
}
