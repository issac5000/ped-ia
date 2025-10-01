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
  let chosenKey = '';
  let mode = 'SERVICE';

  if (targetPath.startsWith('anon-')) {
    chosenKey = process.env.SUPABASE_ANON_KEY || '';
    mode = 'ANON';
  } else if (targetPath === 'profiles-create-anon') {
    chosenKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    mode = 'SERVICE';
  } else {
    chosenKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    mode = 'SERVICE';
  }
  const headers = {
    'Content-Type': 'application/json',
    apikey: chosenKey,
    Authorization: `Bearer ${chosenKey}`,
  };

  const keyPreview = (chosenKey || '').slice(0, 15);
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
