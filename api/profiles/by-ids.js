// Fonction serverless Vercel pour récupérer un sous-ensemble public de profils par identifiants
// Requiert les variables : SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (ou variantes NEXT_PUBLIC)

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      return res.end('Method Not Allowed');
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!serviceKey || !supaUrl) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Server misconfigured' }));
    }

    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Missing Authorization' }));
    }

    // Vérifie que l’appelant est bien authentifié (limite le scraping anonyme)
    const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey || serviceKey }
    });
    if (!uRes.ok) {
      const t = await uRes.text().catch(()=>'');
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Invalid token', details: t }));
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body || '{}');
    const ids = Array.isArray(json?.ids) ? json.ids.map(x=>String(x)).filter(Boolean) : [];
    if (!ids.length) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'ids required' }));
    }
    if (ids.length > 200) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'too many ids' }));
    }

    // Construit la liste de filtres PostgREST in() : ("id1","id2")
    const escaped = ids.map(id => String(id).replace(/"/g, '""'));
    const list = `(${escaped.map(id=>`"${id}"`).join(',')})`;
    const fetchProfiles = async (select) => {
      const url = `${supaUrl}/rest/v1/profiles?select=${encodeURIComponent(select)}&id=in.${encodeURIComponent(list)}`;
      const resProfiles = await fetch(url, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      const text = await resProfiles.text().catch(() => '');
      if (!resProfiles.ok) {
        const err = new Error(text || 'Fetch profiles failed');
        err.status = resProfiles.status;
        err.details = text;
        throw err;
      }
      try {
        return text ? JSON.parse(text) : [];
      } catch (e) {
        throw new Error('Invalid JSON response from Supabase');
      }
    };

    let profiles = [];
    let hasShowColumn = true;
    try {
      profiles = await fetchProfiles('id,full_name,show_children_count');
    } catch (err) {
      hasShowColumn = false;
      profiles = await fetchProfiles('id,full_name');
    }

    const idList = Array.isArray(profiles) ? profiles.map((row) => row?.id).filter((id) => id != null) : [];
    const idsForCounts = idList.map((id) => String(id));
    const childCounts = new Map();
    if (idsForCounts.length) {
      const childrenUrl = `${supaUrl}/rest/v1/children?select=user_id&user_id=in.${encodeURIComponent(list)}`;
      const cRes = await fetch(childrenUrl, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      const cText = await cRes.text().catch(() => '');
      if (!cRes.ok) {
        const err = new Error(cText || 'Fetch children failed');
        err.status = cRes.status;
        err.details = cText;
        throw err;
      }
      let childRows = [];
      try {
        childRows = cText ? JSON.parse(cText) : [];
      } catch {
        childRows = [];
      }
      if (Array.isArray(childRows)) {
        childRows.forEach((row) => {
          const key = row?.user_id != null ? String(row.user_id) : '';
          if (!key) return;
          childCounts.set(key, (childCounts.get(key) || 0) + 1);
        });
      }
    }

    const arr = Array.isArray(profiles) ? profiles : [];
    const enriched = arr.map((row) => {
      const id = row?.id != null ? String(row.id) : null;
      const count = id ? childCounts.get(id) ?? 0 : 0;
      const showFlagRaw = row?.show_children_count;
      const showChildren = hasShowColumn ? !!showFlagRaw : false;
      return {
        ...row,
        child_count: count,
        show_children_count: showChildren,
      };
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ profiles: enriched }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Server error', details: String(e.message || e) }));
  }
}
