// /api/edge/[...slug].js
// Exige SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY dans l'env (Vercel).

const ANON_FIRST_SLUGS = new Set([
  'profiles-create-anon',
  'anon-parent-updates',
  'anon-children',
  'anon-family',
  'anon-messages',
  'anon-community',
  'likes-get',
  'likes-add',
  'likes-remove',
]);

const isBearerJwt = (value = '') => {
  const m = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(value);
  return !!m;
};

export default async function handler(req, res) {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ success: false, error: 'Missing Supabase env vars' });
      return;
    }

    const raw = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug].filter(Boolean);
    const slug = raw.join('/').trim();
    if (!slug) {
      res.status(404).json({ success: false, error: 'Missing function slug' });
      return;
    }

    const first = slug.split('/')[0];
    const useAnon = ANON_FIRST_SLUGS.has(first);
    const invocationKey = useAnon ? SUPABASE_ANON_KEY : SUPABASE_SERVICE_ROLE_KEY;

    // Headers sortants vers Supabase Functions
    const incomingAuth = req.headers['authorization'];
    const clientJwtHeader = req.headers['x-client-authorization'];
    const outHeaders = new Headers();

    // 1) Invocation: toujours la clé Supabase (anon ou service)
    outHeaders.set('Authorization', `Bearer ${invocationKey}`);
    outHeaders.set('apikey', invocationKey);

    // 2) JWT utilisateur: uniquement dans X-Client-Authorization
    if (clientJwtHeader && isBearerJwt(clientJwtHeader)) {
      outHeaders.set('X-Client-Authorization', clientJwtHeader);
    } else if (incomingAuth && isBearerJwt(incomingAuth)) {
      // compat: si le client mettait encore le JWT dans Authorization, on le déplace
      outHeaders.set('X-Client-Authorization', incomingAuth);
    }

    const ct = req.headers['content-type'] || 'application/json';
    outHeaders.set('Content-Type', ct);
    outHeaders.set('Cache-Control', 'no-store');

    // Corps (préserve tel quel)
    const method = req.method || 'POST';
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      if (typeof req.body === 'string') body = req.body;
      else if (req.body && Object.keys(req.body).length) body = JSON.stringify(req.body);
      else {
        body = await new Promise((resolve) => {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => resolve(data || undefined));
        });
      }
    }

    const url = `${SUPABASE_URL}/functions/v1/${slug}`;
    const r = await fetch(url, { method, headers: outHeaders, body });
    const text = await r.text();

    // On forward status + body, sans loguer de secrets
    res.status(r.status);
    const rct = r.headers.get('content-type') || '';
    if (rct.includes('application/json')) res.setHeader('Content-Type', 'application/json');
    res.send(text);
  } catch (e) {
    res.status(500).json({ success: false, error: String(e?.message || e) });
  }
}
