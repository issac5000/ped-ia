export default async function handler(req, res) {
  console.log('DEBUG edge handler', req.url, req.query);

  // Extraction du slug cible
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

  const rawBaseUrl = process.env.SUPABASE_EDGE_FUNCTION_URL
    || process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || 'https://myrwcjurblksypvekuzb.supabase.co';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/functions/v1/${targetPath}`;
  const isAnon = targetPath.startsWith('anon-');
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || '';
  const chosenKey = isAnon ? anonKey : serviceKey;
  const mode = isAnon ? 'ANON' : 'SERVICE';
  if (!chosenKey) {
    console.error('Proxying Supabase Edge request failed: missing credentials', { mode, targetPath });
    res.status(500).setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ error: 'Supabase credentials manquantes', details: `Missing ${mode === 'ANON' ? 'anon' : 'service'} key` });
  }
  const headers = {
    'Content-Type': 'application/json',
    apikey: chosenKey,
    Authorization: `Bearer ${chosenKey}`,
  };

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
  console.log('Edge fetch debug', {
    targetUrl,
    headers: {
      apikey: headers.apikey ? `${headers.apikey.slice(0, 10)}...` : 'missing',
      Authorization: headers.Authorization ? headers.Authorization.split(' ')[0] : 'missing',
      'Content-Type': headers['Content-Type'],
    },
  });

  console.log('Proxy Mode:', mode, 'Slug:', targetPath, 'Key:', keyPreview ? `${keyPreview}...` : '[empty]');

  console.log('Proxy Debug', {
    slug: targetPath,
    mode,
    keyPreview: keyPreview ? `${keyPreview}...` : '[empty]',
    method: req.method,
    headers: safeHeaders,
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
