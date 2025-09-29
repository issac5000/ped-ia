import { processAnonChildrenRequest } from '../../lib/anon-children.js';

// Route API Next.js pour les opérations anonymes sur les profils enfants

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    let bodyRaw = '';
    for await (const chunk of req) bodyRaw += chunk;
    let payload = {};
    if (bodyRaw) {
      try {
        payload = JSON.parse(bodyRaw);
      } catch (e) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const result = await processAnonChildrenRequest(payload);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(result.status).json(result.body);
  } catch (e) {
    const status = e && Number.isInteger(e.status) ? e.status : 500;
    const details = String(e?.details || e?.message || e);
    console.error('[api/anon/children] handler error', { status, details, error: e });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json({ error: 'Server error', details });
  }
}
