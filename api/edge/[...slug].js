// /api/edge/[...slug].js
export default async function handler(req, res) {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ success: false, error: 'Missing Supabase env vars' });
      return;
    }

    const slug = Array.isArray(req.query.slug)
      ? req.query.slug.join('/')
      : req.query.slug;

    if (!slug) {
      res.status(404).json({ success: false, error: 'Missing function slug' });
      return;
    }

    // Pour simplifier: utilise toujours la service role key comme clé d’invocation
    const invocationKey = SUPABASE_SERVICE_ROLE_KEY;

    // Prépare les headers sortants
    const outHeaders = new Headers();
    outHeaders.set('Authorization', `Bearer ${invocationKey}`);
    outHeaders.set('apikey', SUPABASE_ANON_KEY); // apikey toujours présent
    outHeaders.set('Content-Type', req.headers['content-type'] || 'application/json');

    // Si le client a envoyé un X-Client-Authorization (JWT), on le propage
    if (req.headers['x-client-authorization']) {
      outHeaders.set('X-Client-Authorization', req.headers['x-client-authorization']);
    }

    // Corps de la requête
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
      } else {
        body = await new Promise((resolve) => {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => resolve(data || undefined));
        });
      }
    }

    const url = `${SUPABASE_URL}/functions/v1/${slug}`;
    const r = await fetch(url, {
      method: req.method || 'POST',
      headers: outHeaders,
      body,
    });

    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'text/plain');
    res.send(text);
  } catch (e) {
    res.status(500).json({ success: false, error: String(e?.message || e) });
  }
}
