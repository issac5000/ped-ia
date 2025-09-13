// Vercel serverless function to fetch limited public profile fields by ids
// Requires env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (or NEXT_PUBLIC variants)

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

    // Verify requester is an authenticated user (prevents open scraping)
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

    // Build PostgREST in() filter list: ("id1","id2")
    const escaped = ids.map(id => String(id).replace(/"/g, '""'));
    const list = `(${escaped.map(id=>`"${id}"`).join(',')})`;
    const q = `${supaUrl}/rest/v1/profiles?select=id,full_name&id=in.${encodeURIComponent(list)}`;
    const pRes = await fetch(q, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    if (!pRes.ok) {
      const t = await pRes.text().catch(()=> '');
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Fetch profiles failed', details: t }));
    }
    const arr = await pRes.json();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ profiles: arr }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Server error', details: String(e.message || e) }));
  }
}
