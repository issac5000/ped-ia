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

  const incomingAuthHeaderRaw = req?.headers?.authorization;
  let incomingAuthHeader = '';
  if (Array.isArray(incomingAuthHeaderRaw)) {
    incomingAuthHeader = incomingAuthHeaderRaw.find(Boolean) || '';
  } else if (typeof incomingAuthHeaderRaw === 'string') {
    incomingAuthHeader = incomingAuthHeaderRaw;
  }

  const incomingApiKeyRaw = req?.headers?.apikey;
  let incomingApiKey = '';
  if (Array.isArray(incomingApiKeyRaw)) {
    incomingApiKey = incomingApiKeyRaw.find(Boolean) || '';
  } else if (typeof incomingApiKeyRaw === 'string') {
    incomingApiKey = incomingApiKeyRaw;
  }

  const hasIncomingAuth = Boolean(incomingAuthHeader && incomingAuthHeader.trim());
  let injectedKey = null;
  let mode = 'FORWARDED_AUTH';

  const contentTypeHeader = req?.headers?.['content-type'];
  const headers = {};
  if (contentTypeHeader) {
    headers['Content-Type'] = contentTypeHeader;
  } else {
    headers['Content-Type'] = 'application/json';
  }

  if (hasIncomingAuth) {
    headers.Authorization = incomingAuthHeader.trim();
    if (incomingApiKey && incomingApiKey.trim()) {
      headers.apikey = incomingApiKey.trim();
    }
  } else {
    const rawKey = isAnonEndpoint
      ? process.env.SUPABASE_ANON_KEY
      : process.env.SUPABASE_SERVICE_ROLE_KEY;
    const chosenKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (chosenKey) {
      headers.apikey = chosenKey;
      headers.Authorization = `Bearer ${chosenKey}`;
      injectedKey = isAnonEndpoint ? 'ANON' : 'SERVICE';
      mode = injectedKey === 'ANON' ? 'ANON_KEY' : 'SERVICE_ROLE_KEY';
    } else {
      mode = isAnonEndpoint ? 'ANON_KEY' : 'SERVICE_ROLE_KEY';
    }
  }

  console.log('[Edge Proxy] Forwarding Supabase request', {
    slug: targetPath,
    mode,
    hasClientAuth: hasIncomingAuth,
    injectedKey,
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
