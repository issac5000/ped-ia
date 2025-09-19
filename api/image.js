// Endpoint /api/image — proxie vers Gemini pour la génération d'images.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const raw = await readBody(req);
    const body = safeJsonParse(raw);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt manquant' });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('[api/image] Missing GOOGLE_API_KEY');
      return res.status(500).json({ error: 'Configuration serveur incomplète' });
    }

    console.info('[api/image] Appel Gemini', { promptPreview: prompt.slice(0, 80), promptLength: prompt.length });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: 'image/png'
        }
      })
    });
    const payloadText = await response.text();
    console.info('[api/image] Réponse Gemini', { status: response.status, ok: response.ok });
    if (!response.ok) {
      let parsed = null;
      try { parsed = JSON.parse(payloadText || '{}'); } catch {}
      console.error('[api/image] Erreur Gemini', { status: response.status, body: payloadText });
      const message = parsed?.error?.message || parsed?.error || payloadText || 'Image service error';
      return res.status(response.status).json({ error: message, details: parsed?.error });
    }

    let payload = null;
    try { payload = JSON.parse(payloadText || '{}'); } catch (err) {
      console.error('[api/image] JSON parse error', err);
      return res.status(502).json({ error: 'Réponse inattendue du service image' });
    }

    const imageNode = pickFirstImage(payload);
    if (!imageNode?.data) {
      console.error('[api/image] Image absente', payload);
      return res.status(502).json({ error: 'Aucune image générée' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({
      image: imageNode.data,
      mime: imageNode.mime || 'image/png'
    }));
  } catch (error) {
    console.error('[api/image] Exception', error);
    return res.status(500).json({ error: 'Génération indisponible', details: String(error?.message || error) });
  }
}

function safeJsonParse(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (err) {
    console.error('[api/image] Invalid JSON body', err);
    return {};
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', chunk => {
      buf += chunk;
      if (buf.length > 1e6) {
        console.error('[api/image] Payload trop volumineux');
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function pickFirstImage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [];
  if (Array.isArray(payload.images)) candidates.push(...payload.images);
  if (Array.isArray(payload.data)) candidates.push(...payload.data);
  if (Array.isArray(payload.predictions)) candidates.push(...payload.predictions);
  if (payload.output && Array.isArray(payload.output)) candidates.push(...payload.output);
  const inline = payload?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (inline) {
    const { data, mimeType } = inline.inlineData;
    if (data) return { data, mime: mimeType };
  }
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const data = item.data || item.base64 || item.base64Data || item.bytesBase64Encoded || item.image || item.inlineData?.data;
    if (data) {
      const mime = item.mimeType || item.mime || item.inlineData?.mimeType || 'image/png';
      return { data, mime };
    }
  }
  return null;
}
