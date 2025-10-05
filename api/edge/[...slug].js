export default async function handler(req, res) {
  console.log('DEBUG edge handler', req.url, req.query);

  // --- Extraction du slug cible
  const querySlug = req?.query?.slug;
  let targetPath = '';

  if (Array.isArray(querySlug)) {
    targetPath = querySlug.join('/');
  } else if (typeof querySlug === 'string' && querySlug.trim()) {
    targetPath = querySlug.trim();
  } else if (req.url) {
    const fallback = req.url.replace(/^\/api\/edge\/?/, '');
    targetPath = fallback.split('?')[0].trim();
  }

  if (!targetPath) {
    res.status(400).setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ error: 'Missing target function slug' });
  }

  // --- Préparation de l’URL cible
  const baseUrl = 'https://myrwcjurblksypvekuzb.supabase.co'.replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/functions/v1/${targetPath}`;
  const isAnon = targetPath.startsWith('anon-');

  // --- Sélection de la clé Supabase
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const chosenKey = isAnon ? anonKey : serviceKey;
  const mode = isAnon ? 'ANON' : 'SERVICE';

  // --- Headers par défaut
  const headers = {
    'Content-Type': 'application/json',
    apikey: chosenKey,
  };

  // --- 🔧 Injection du bon header Authorization
  // Si un JWT ou code client existe, on le relaie tel quel.
  const incomingAuth =
    req.headers.get?.('authorization') ||
    req.headers?.authorization ||
    req.headers.get?.('Authorization') ||
    req.headers?.Authorization ||
    null;

  const incomingXClientAuth =
    req.headers.get?.('x-client-authorization') ||
    req.headers?.['x-client-authorization'] ||
    null;

  if (incomingXClientAuth) {
    headers.Authorization = incomingXClientAuth;
  } else if (incomingAuth) {
    headers.Authorization = incomingAuth;
  } else {
    // Fallback : on garde la clé service uniquement si aucun token client n’existe
    headers.Authorization = `Bearer ${chosenKey}`;
  }

  // --- Logs nettoyés pour débogage
  const keyPreview = (chosenKey || '').slice(0, 20);
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).map(([header, value]) => {
      if (typeof value !== 'string') return [header, value];
      if (/^bearer /i.test(value)) {
        return [header, `Bearer ${(value.slice(7, 27) || '')}...`];
      }
      return [header, `${value.slice(0, 20)}...`];
    })
  );

  console.log('Proxying Supabase Edge request', { slug: targetPath, mode, headers: Object.keys(headers) });
  console.log('[DEBUG Proxy → Supabase]', {
    targetUrl,
    mode,
    method: req.method,
    incomingAuth,
    incomingXClientAuth,
    outgoingHeaders: safeHeaders,
    hasBody: !!req.body,
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
