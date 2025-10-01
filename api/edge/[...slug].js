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

  const targetUrl = `https://myrwcjurblksypvekuzb.supabase.co/functions/v1/${targetPath}`;
  const isAnon = targetPath.startsWith('anon-') || targetPath === 'profiles-create-anon';
  const key = isAnon
    ? process.env.SUPABASE_ANON_KEY || ''
    : process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const mode = isAnon ? 'ANON' : 'SERVICE';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };

  const keyPreview = (key || '').slice(0, 20);
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).map(([header, value]) => {
      if (typeof value !== 'string') return [header, value];
      if (/^bearer /i.test(value)) {
        return [header, `Bearer ${(value.slice(7, 27) || '')}...`];
      }
      return [header, `${value.slice(0, 20)}...`];
    })
  );

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
