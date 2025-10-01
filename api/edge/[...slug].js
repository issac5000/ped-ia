export default async function handler(req, res) {
  const querySlug = req?.query?.slug;
  let targetPath = '';

  if (Array.isArray(querySlug)) {
    targetPath = querySlug.join('/');
  } else if (typeof querySlug === 'string' && querySlug.trim()) {
    targetPath = querySlug.trim();
  } else {
    const fallback = req.url.replace(/^\/api\/edge\/?/, '');
    targetPath = fallback.split('?')[0].trim();
  }

  if (!targetPath) {
    res.status(400).setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ error: 'Missing target function slug' });
  }

  const baseUrl = 'https://myrwcjurblksypvekuzb.supabase.co'.replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/functions/v1/${targetPath}`;

  const slug = targetPath;
  const usesAnonKey =
    slug === 'profiles-create-anon' || slug.startsWith('anon-') || slug.startsWith('likes-');

  const rawClientAuth = req?.headers?.authorization;
  let clientAuthHeader = '';
  if (Array.isArray(rawClientAuth)) {
    clientAuthHeader = rawClientAuth.find(Boolean) || '';
  } else if (typeof rawClientAuth === 'string') {
    clientAuthHeader = rawClientAuth;
  }

  const chosenKeyRaw = usesAnonKey
    ? process.env.SUPABASE_ANON_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chosenKey = typeof chosenKeyRaw === 'string' ? chosenKeyRaw.trim() : '';

  if (!chosenKey) {
    console.error('[Edge Proxy] Missing Supabase key for mode', usesAnonKey ? 'ANON' : 'SERVICE');
  }

  const outgoingHeaders = {};
  const contentTypeHeader = req?.headers?.['content-type'];
  if (contentTypeHeader) {
    outgoingHeaders['Content-Type'] = contentTypeHeader;
  } else {
    outgoingHeaders['Content-Type'] = 'application/json';
  }

  if (chosenKey) {
    outgoingHeaders.apikey = chosenKey;
    outgoingHeaders.Authorization = `Bearer ${chosenKey}`;
  }
  if (clientAuthHeader && clientAuthHeader.trim()) {
    outgoingHeaders['X-Client-Authorization'] = clientAuthHeader.trim();
  }

  const bodyAllowed = !['GET', 'HEAD'].includes((req.method || '').toUpperCase());
  let outgoingBody;
  if (bodyAllowed) {
    if (typeof req.body === 'string' || req.body instanceof Buffer) {
      outgoingBody = req.body;
    } else if (req.body != null) {
      try {
        outgoingBody = JSON.stringify(req.body);
      } catch (_err) {
        outgoingBody = JSON.stringify({});
      }
    }
    if (typeof outgoingBody === 'undefined') {
      outgoingBody = JSON.stringify({});
    }
  }

  const outgoingHeaderNames = ['apikey', 'Authorization'];
  if (outgoingHeaders['X-Client-Authorization']) {
    outgoingHeaderNames.push('X-Client-Authorization');
  }

  console.log('[Edge Proxy] Forwarding Supabase request', {
    slug,
    mode: usesAnonKey ? 'ANON' : 'SERVICE',
    hasClientAuth: Boolean(outgoingHeaders['X-Client-Authorization']),
    outgoingHeaders: outgoingHeaderNames,
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: outgoingBody,
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (err) {
    console.error('Edge proxy error:', err);
    res.status(500).setHeader('Access-Control-Allow-Origin', '*');
    res.json({ error: err?.message || 'Edge proxy failed' });
  }
}
