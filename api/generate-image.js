// Fonction serverless : /api/generate-image
// Génère une illustration à partir d'un prompt en appelant Gemini 2.5 Flash Image
export async function generateImage(body = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const err = new Error('Missing GOOGLE_API_KEY');
    err.status = 500;
    throw err;
  }

  const promptRaw = (body?.prompt ?? '').toString().trim();
  if (!promptRaw) {
    const err = new Error('prompt required');
    err.status = 400;
    throw err;
  }

  const prompt = promptRaw.slice(0, 600);
  const child = safeChildSummary(body.child);

  const parts = [
    { text: 'Crée une illustration colorée, douce et rassurante adaptée aux enfants de 0 à 7 ans. Style chaleureux, sans violence ni éléments effrayants.' },
    { text: child && child !== 'Aucun profil' ? `Contexte enfant: ${JSON.stringify(child)}` : 'Contexte enfant: aucun détail spécifique.' },
    { text: `Description à illustrer: ${prompt}` }
  ];

  const payload = {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature: 0.5,
      responseMimeType: 'image/png'
    }
  };

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
  const url = `${endpoint}?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await resp.text();
  if (!resp.ok) {
    let details = text;
    try {
      const errJson = JSON.parse(text);
      details = errJson?.error?.message || errJson?.error?.status || details;
    } catch {}
    const err = new Error(`Gemini error: ${details}`);
    err.status = resp.status >= 400 ? resp.status : 502;
    throw err;
  }

  let data;
  try { data = JSON.parse(text); }
  catch {
    const err = new Error('Invalid response from Gemini');
    err.status = 502;
    throw err;
  }

  const inlineData = data?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data)?.inlineData;
  if (!inlineData?.data) {
    const err = new Error('No image data returned');
    err.status = 502;
    throw err;
  }

  const mimeType = inlineData.mimeType || 'image/png';
  return { imageBase64: inlineData.data, mimeType };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const result = await generateImage(body);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(result));
  } catch (e) {
    const status = Number.isInteger(e?.status) ? e.status : Number.isInteger(e?.statusCode) ? e.statusCode : 500;
    const details = e?.details ? String(e.details) : String(e?.message || e);
    return res.status(status).json({ error: 'Image generation failed', details });
  }
}

function safeChildSummary(child) {
  if (!child) return 'Aucun profil';
  return {
    prenom: child.firstName,
    sexe: child.sex,
    date_naissance: child.dob,
    contexte: child.context,
    jalons: child.milestones,
    mesures: child.growth,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
