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
  const isAnonEndpoint =
    targetPath.startsWith('anon-') || targetPath === 'profiles-create-anon';
  const chosenKey = isAnonEndpoint
    ? process.env.SUPABASE_ANON_KEY || ''
    : process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const incomingAuthHeaderRaw = req?.headers?.authorization;
  let incomingAuthHeader = '';
  if (Array.isArray(incomingAuthHeaderRaw)) {
    incomingAuthHeader = incomingAuthHeaderRaw.find(Boolean) || '';
  } else if (typeof incomingAuthHeaderRaw === 'string') {
    incomingAuthHeader = incomingAuthHeaderRaw;
  }

  const hasIncomingAuth = Boolean(incomingAuthHeader && incomingAuthHeader.trim());
  const mode = hasIncomingAuth
    ? 'FORWARDED_AUTH'
    : isAnonEndpoint
    ? 'ANON_KEY'
    : 'SERVICE_ROLE_KEY';

  const contentTypeHeader = req?.headers?.['content-type'];
  const headers = {};
  if (contentTypeHeader) {
    headers['Content-Type'] = contentTypeHeader;
  } else {
    headers['Content-Type'] = 'application/json';
  }

  if (chosenKey) {
    headers.apikey = chosenKey;
  }

  if (hasIncomingAuth) {
    headers.Authorization = incomingAuthHeader.trim();
  } else if (chosenKey) {
    headers.Authorization = `Bearer ${chosenKey}`;
  }

  console.log('[Edge Proxy] Forwarding Supabase request', {
    slug: targetPath,
    mode,
    method: req.method,
    headers: {
      apikey: headers.apikey ? `${headers.apikey.slice(0, 6)}***` : 'missing',
      Authorization: headers.Authorization
        ? headers.Authorization.toLowerCase().startsWith('bearer ')
          ? 'Bearer ***'
          : 'present'
        : 'missing',
      'Content-Type': headers['Content-Type'],
    },
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body || {}) : undefined,
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
