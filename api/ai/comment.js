// Serverless Function: /api/ai/comment
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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const content = String(body.content || '').slice(0, 2000);
    const system = 'Tu es Ped\u2019IA, un assistant bienveillant pour parents. R\u00e9dige un commentaire clair, positif et bref (moins de 50 mots) sur la mise \u00e0 jour fournie.';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'OpenAI error', details: t });
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim() || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ text }));
  } catch (e) {
    return res.status(500).json({ error: 'IA indisponible', details: String(e?.message || e) });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
